import * as XLSX from 'xlsx';
import { MenuItem, MenuOption, MenuData, AppConfig } from '../types';

// Updated to the user's specific Google Sheet
const SHEET_ID = '1Oz0V5JU9o67v84qCmPK3h39fEq5_KQmKdjyzAR777ow';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;

// Helper to convert Google Drive links to direct image links
const processImageUrl = (url: string): string => {
  if (!url) return '';
  let cleanUrl = url.trim();
  
  // Check if it is a Google Drive link
  if (cleanUrl.includes('drive.google.com')) {
    // Try to extract the ID
    const idMatch = cleanUrl.match(/\/d\/(.*?)\/|id=(.*?)(&|$)/);
    if (idMatch) {
      const id = idMatch[1] || idMatch[2];
      // Convert to a direct view link
      return `https://drive.google.com/uc?export=view&id=${id}`;
    }
  }
  
  return cleanUrl;
};

// Helper to extract pure Line ID if user pasted a full URL
const extractLineId = (val: unknown): string => {
    if (!val) return '';
    let str = String(val).trim();
    // If it's a URL, try to get the last part
    if (str.includes('line.me')) {
        const parts = str.split('/');
        // Remove query params if any
        str = parts[parts.length - 1].split('?')[0];
    }
    return str;
};

export const fetchMenuFromSheet = async (): Promise<MenuData> => {
  try {
    // Add timestamp to prevent browser caching of the sheet data
    const response = await fetch(`${SHEET_URL}&t=${Date.now()}`);
    
    // Check if the response is actually an XLSX file (not HTML login page)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
        console.error("Google Sheet Permission Error: The sheet is not publicly accessible.");
        throw new Error('PERMISSION_DENIED');
    }

    if (!response.ok) {
      throw new Error('Failed to fetch menu data');
    }

    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    // Store aggregated data from all sheets
    const groupedItems: Record<string, MenuItem> = {};
    const config: AppConfig = {};

    // Iterate through ALL sheets in the workbook
    workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        
        // --- SMART HEADER DETECTION PER SHEET ---
        // Convert to array of arrays first to scan for the header row
        const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        
        if (!rows || rows.length === 0) return; // Skip empty sheets

        let headerRowIndex = 0;
        const searchKeywords = ['name', 'menu', 'item', 'ชื่อ', 'รายการ', 'category', 'หมวด', 'price', 'ราคา'];
        let foundHeader = false;

        // Scan first 10 rows to find the most likely header row
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const rowStr = JSON.stringify(rows[i]).toLowerCase();
            // If row contains at least 2 keywords, assume it's the header
            const matchCount = searchKeywords.filter(k => rowStr.includes(k)).length;
            if (matchCount >= 2) {
                headerRowIndex = i;
                foundHeader = true;
                break;
            }
        }
        
        // Parse using the found header row
        const rawData = XLSX.utils.sheet_to_json<any>(sheet, { range: headerRowIndex });
        
        rawData.forEach((row, index) => {
          // Helper to find value with strict logic
          const getValue = (keys: string[], exclude: string[] = []) => {
            const rowKeys = Object.keys(row);
            
            // 1. Exact match (High Priority)
            const exact = rowKeys.find(k => keys.some(s => k.toLowerCase() === s.toLowerCase()));
            if (exact) return row[exact];
            
            // 2. Partial match (Lower Priority, with exclusions)
            const partial = rowKeys.find(k => {
                const lowerK = k.toLowerCase();
                // Must contain one of the keys
                const matchesKey = keys.some(s => lowerK.includes(s.toLowerCase()));
                // Must NOT contain any excluded terms
                const isExcluded = exclude.some(e => lowerK.includes(e.toLowerCase()));
                return matchesKey && !isExcluded;
            });
            return partial ? row[partial] : undefined;
          };

          const category = String(getValue(['category', 'type', 'หมวด', 'ประเภท', 'group']) || 'General');
          const rawName = getValue(['name', 'menu', 'item', 'food', 'ชื่อ', 'รายการ', 'เมนู'], ['option', 'choice', 'ตัวเลือก', 'ราคา', 'price', 'img']);
          const name = String(rawName || '').trim();
          const rawImg = getValue(['image', 'img', 'url', 'photo', 'รูป', 'pic', 'link']);
          const processedImg = rawImg ? processImageUrl(String(rawImg)) : '';

          // --- CONFIGURATION EXTRACTION ---
          // Check if this row is a setting row (Category = Setting/Config)
          if (['setting', 'config', 'system', 'ตั้งค่า'].some(k => category.toLowerCase().includes(k))) {
              if (name.toLowerCase().includes('logo')) {
                  config.logoUrl = processedImg;
              } else if (name.toLowerCase().includes('qr') || name.toLowerCase().includes('payment')) {
                  config.qrCodeUrl = processedImg;
              } else if (name.toLowerCase().includes('line')) {
                  // For Line ID, we search in multiple possible columns since users might put it in 'Price' or 'Description'
                  // instead of 'Image'.
                  const possibleId = 
                    processedImg || 
                    getValue(['price', 'cost', 'ราคา', 'value', 'ค่า', 'detail', 'description', 'option']) ||
                    '';
                  
                  if (possibleId) {
                      config.lineOaId = extractLineId(possibleId); 
                  }
              }
              return; // Skip adding this to the menu list
          }

          // --- MENU ITEM EXTRACTION ---
          if (!rawName) return; // Skip rows without a valid name

          // If item doesn't exist yet, create it
          if (!groupedItems[name]) {
              const price = getValue(['price', 'cost', 'ราคา', 'บาท'], ['option']);
              const desc = getValue(['description', 'detail', 'รายละเอียด', 'ส่วนประกอบ', 'คำอธิบาย']);
              
              const finalImg = processedImg || `https://picsum.photos/seed/${name.replace(/\s/g, '')}/300/200`;

              groupedItems[name] = {
                id: `item-${Object.keys(groupedItems).length}`,
                name: name,
                price: Number(price) || 0,
                category: category,
                description: desc ? String(desc) : undefined,
                image: finalImg,
                isSpicy: name.includes('Spicy') || (desc && String(desc).includes('พริก')) || name.includes('ต้มยำ') || name.includes('เผ็ด'),
                options: []
              };
          }

          const item = groupedItems[name];

          // --- Option Parsing Logic ---
          const optGroupKey = getValue(['option_group_name', 'group_name', 'option_group', 'หัวข้อตัวเลือก', 'กลุ่มตัวเลือก']);
          const optChoiceKey = getValue(['option_name', 'choice_name', 'sub_option', 'ตัวเลือก', 'ชื่อตัวเลือก']);
          const optPriceModKey = getValue(['option_price_modifier', 'price_modifier', 'add_price', 'ราคาเพิ่ม', 'บวก', 'modifier']);
          
          const priceMod = Number(optPriceModKey) || 0;

          let optionAdded = false;

          // Case 1: Row-based
          if (optGroupKey && optChoiceKey) {
              const groupName = String(optGroupKey).trim();
              const choiceName = String(optChoiceKey).trim();

              if (groupName && choiceName) {
                  let existingGroup = item.options?.find(o => o.name === groupName);
                  if (!existingGroup) {
                      existingGroup = { name: groupName, choices: [] };
                      item.options?.push(existingGroup);
                  }
                  if (!existingGroup.choices.some(c => c.name === choiceName)) {
                      existingGroup.choices.push({ name: choiceName, priceModifier: priceMod });
                  }
                  optionAdded = true;
              }
          }

          // Case 2: Comma separated (Assume no price modifier for this simplified format, or 0)
          if (!optionAdded) {
              const optName = getValue(['option_header', 'หัวข้อ'], ['group']);
              const optChoices = getValue(['option_choices', 'choices', 'selections'], ['group', 'name']);
              
              if (optName && optChoices) {
                  const newChoicesStr = String(optChoices).split(',').map(s => s.trim()).filter(s => s);
                  if (newChoicesStr.length > 0) {
                      const existingOpt = item.options?.find(o => o.name === optName);
                      const newChoiceObjs = newChoicesStr.map(c => ({ name: c, priceModifier: 0 }));

                      if (existingOpt) {
                            // Merge choices avoiding duplicates
                            newChoiceObjs.forEach(nc => {
                                if (!existingOpt.choices.some(ec => ec.name === nc.name)) {
                                    existingOpt.choices.push(nc);
                                }
                            });
                      } else {
                            item.options?.push({
                                name: String(optName),
                                choices: newChoiceObjs
                            });
                      }
                  }
              }
          }
        });
    });

    return {
        items: Object.values(groupedItems),
        config: config
    };

  } catch (error) {
    console.error("Error loading menu:", error);
    return {
        items: [],
        config: {}
    };
  }
};