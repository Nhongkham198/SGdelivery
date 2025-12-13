
import * as XLSX from 'xlsx';
import { MenuItem, MenuOption, MenuData, AppConfig, DailySchedule } from '../types';

// Updated to the user's specific Google Sheet
const SHEET_ID = '1Oz0V5JU9o67v84qCmPK3h39fEq5_KQmKdjyzAR777ow';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;

// Helper to convert Google Drive links to direct image links
const processImageUrl = (url: string): string => {
  if (!url) return '';
  let cleanUrl = url.trim();
  
  if (cleanUrl.includes('drive.google.com')) {
    const idMatch = cleanUrl.match(/\/d\/(.*?)\/|id=(.*?)(&|$)/);
    if (idMatch) {
      const id = idMatch[1] || idMatch[2];
      return `https://drive.google.com/uc?export=view&id=${id}`;
    }
  }
  return cleanUrl;
};

const extractLineId = (val: unknown): string => {
    if (!val) return '';
    let str = String(val).trim();
    if (str.includes('line.me')) {
        const parts = str.split('/');
        str = parts[parts.length - 1].split('?')[0];
    }
    return str;
};

const formatTime = (val: unknown): string | undefined => {
    if (!val) return undefined;
    let str = String(val).trim();
    str = str.replace('.', ':');
    if (/^\d{1,2}:\d{2}$/.test(str)) {
        const [h, m] = str.split(':');
        return `${h.padStart(2, '0')}:${m}`;
    }
    return undefined;
};

// Helper to parse Day Name to Index (0-6)
const getDayIndex = (name: string): number | null => {
    const n = name.toLowerCase().trim();
    // Thai
    if (n.includes('อาทิตย์') || n.includes('sunday') || n === 'sun') return 0;
    if (n.includes('จันทร์') || n.includes('monday') || n === 'mon') return 1;
    if (n.includes('อังคาร') || n.includes('tuesday') || n === 'tue') return 2;
    if (n.includes('พุธ') || n.includes('wednesday') || n === 'wed') return 3;
    if (n.includes('พฤหัส') || n.includes('thursday') || n === 'thu') return 4;
    if (n.includes('ศุกร์') || n.includes('friday') || n === 'fri') return 5;
    if (n.includes('เสาร์') || n.includes('saturday') || n === 'sat') return 6;
    return null;
};

// Helper to parse Schedule Value string
const parseScheduleValue = (val: string): DailySchedule | null => {
    const v = val.toLowerCase().trim();
    
    // Check for Closed keywords
    if (v.includes('close') || v.includes('ปิด') || v.includes('หยุด') || v.includes('off')) {
        return { isClosed: true };
    }

    // Check for Time Range (e.g. 09:00-18:00, 9.00 - 18.00, 9-20)
    // Regex matches HH:MM or H.MM followed by separator followed by HH:MM
    const timeMatch = v.match(/(\d{1,2}(?:[:.]\d{2})?)\s*[-–toถึง]\s*(\d{1,2}(?:[:.]\d{2})?)/);
    
    if (timeMatch) {
        // Function to ensure time has minutes
        const normalize = (t: string) => {
            if (!t.includes(':') && !t.includes('.')) return `${t}:00`; // "9" -> "9:00"
            return t;
        };
        
        const open = formatTime(normalize(timeMatch[1]));
        const close = formatTime(normalize(timeMatch[2]));
        
        if (open && close) {
            return { isClosed: false, open, close };
        }
    }
    
    return null;
};

export const fetchMenuFromSheet = async (): Promise<MenuData> => {
  try {
    const response = await fetch(`${SHEET_URL}&t=${Date.now()}`);
    
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
        console.error("Google Sheet Permission Error");
        throw new Error('PERMISSION_DENIED');
    }

    if (!response.ok) {
      throw new Error('Failed to fetch menu data');
    }

    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    const groupedItems: Record<string, MenuItem> = {};
    const config: AppConfig = { schedules: {} };

    workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        if (!rows || rows.length === 0) return;

        let headerRowIndex = 0;
        const searchKeywords = ['name', 'menu', 'item', 'ชื่อ', 'รายการ', 'category', 'หมวด', 'price', 'ราคา'];
        
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const rowStr = JSON.stringify(rows[i]).toLowerCase();
            const matchCount = searchKeywords.filter(k => rowStr.includes(k)).length;
            if (matchCount >= 2) {
                headerRowIndex = i;
                break;
            }
        }
        
        const rawData = XLSX.utils.sheet_to_json<any>(sheet, { range: headerRowIndex });
        
        rawData.forEach((row) => {
          const getValue = (keys: string[], exclude: string[] = []) => {
            const rowKeys = Object.keys(row);
            const exact = rowKeys.find(k => keys.some(s => k.toLowerCase() === s.toLowerCase()));
            if (exact) return row[exact];
            const partial = rowKeys.find(k => {
                const lowerK = k.toLowerCase();
                const matchesKey = keys.some(s => lowerK.includes(s.toLowerCase()));
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
          if (['setting', 'config', 'system', 'ตั้งค่า'].some(k => category.toLowerCase().includes(k))) {
              const value = processedImg || getValue(['price', 'cost', 'ราคา', 'value', 'ค่า', 'detail', 'description', 'option']) || '';
              const lowerName = name.toLowerCase();
              const valStr = String(value).toLowerCase();

              // 1. Basic Configs
              if (lowerName.includes('logo')) {
                  config.logoUrl = processedImg;
              } else if (lowerName.includes('qr') || lowerName.includes('payment')) {
                  config.qrCodeUrl = processedImg;
              } else if (lowerName.includes('line')) {
                  if (value) config.lineOaId = extractLineId(value); 
              
              // 2. Master Status (Emergency Close)
              } else if (lowerName === 'status' || lowerName === 'สถานะ' || lowerName === 'สถานะร้าน') {
                  if (valStr.includes('close') || valStr.includes('ปิด') || valStr.includes('หยุด')) {
                      config.isManualClose = true;
                  }
              
              // 3. Global Open/Close Times
              } else if ((lowerName.includes('open') || lowerName.includes('เปิด')) && !getDayIndex(name)) {
                   const t = formatTime(value);
                   if (t) config.openTime = t;
              } else if ((lowerName.includes('close') || lowerName.includes('ปิด')) && !getDayIndex(name)) {
                   const t = formatTime(value);
                   if (t) config.closeTime = t;

              // 4. GP Extraction (New)
              } else if (lowerName === 'gp' || lowerName.includes('gp')) {
                  const raw = String(value).replace('%', '').trim();
                  const val = parseFloat(raw);
                  if (!isNaN(val)) config.gp = val;
              }
              
              // 5. Specific Daily Schedules (Mon, Tue...)
              const dayIndex = getDayIndex(name);
              if (dayIndex !== null) {
                  const schedule = parseScheduleValue(String(value));
                  if (schedule && config.schedules) {
                      config.schedules[dayIndex] = schedule;
                  }
              }
              
              return;
          }

          // --- MENU ITEM EXTRACTION ---
          if (!rawName) return;

          if (!groupedItems[name]) {
              const price = getValue(['price', 'cost', 'ราคา', 'บาท'], ['option']);
              const desc = getValue(['description', 'detail', 'รายละเอียด', 'ส่วนประกอบ', 'คำอธิบาย']);
              const recommendedVal = getValue(['เมนูแนะนำ', 'recommended', 'recommend', 'best seller', 'signature', 'แนะนำ']);
              const isRec = recommendedVal && (String(recommendedVal).toLowerCase().includes('yes') || String(recommendedVal).toLowerCase() === 'true');
              const finalImg = processedImg || `https://picsum.photos/seed/${name.replace(/\s/g, '')}/300/200`;

              groupedItems[name] = {
                id: `item-${Object.keys(groupedItems).length}`,
                name: name,
                price: Number(price) || 0,
                category: category,
                description: desc ? String(desc) : undefined,
                image: finalImg,
                isSpicy: name.includes('Spicy') || (desc && String(desc).includes('พริก')) || name.includes('ต้มยำ') || name.includes('เผ็ด'),
                isRecommended: isRec,
                options: []
              };
          }

          const item = groupedItems[name];
          const optGroupKey = getValue(['option_group_name', 'group_name', 'option_group', 'หัวข้อตัวเลือก', 'กลุ่มตัวเลือก']);
          const optChoiceKey = getValue(['option_name', 'choice_name', 'sub_option', 'ตัวเลือก', 'ชื่อตัวเลือก']);
          const optPriceModKey = getValue(['option_price_modifier', 'price_modifier', 'add_price', 'ราคาเพิ่ม', 'บวก', 'modifier']);
          const priceMod = Number(optPriceModKey) || 0;

          let optionAdded = false;

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

          if (!optionAdded) {
              const optName = getValue(['option_header', 'หัวข้อ'], ['group']);
              const optChoices = getValue(['option_choices', 'choices', 'selections'], ['group', 'name']);
              if (optName && optChoices) {
                  const newChoicesStr = String(optChoices).split(',').map(s => s.trim()).filter(s => s);
                  if (newChoicesStr.length > 0) {
                      const existingOpt = item.options?.find(o => o.name === optName);
                      const newChoiceObjs = newChoicesStr.map(c => ({ name: c, priceModifier: 0 }));
                      if (existingOpt) {
                            newChoiceObjs.forEach(nc => {
                                if (!existingOpt.choices.some(ec => ec.name === nc.name)) existingOpt.choices.push(nc);
                            });
                      } else {
                            item.options?.push({ name: String(optName), choices: newChoiceObjs });
                      }
                  }
              }
          }
        });
    });

    return { items: Object.values(groupedItems), config: config };

  } catch (error) {
    console.error("Error loading menu:", error);
    return { items: [], config: {} };
  }
};
