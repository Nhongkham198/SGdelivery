import { GoogleGenAI } from "@google/genai";
import { MenuItem } from '../types';

export const getFoodRecommendation = async (userQuery: string, menu: MenuItem[], apiKey?: string): Promise<string> => {
  // Priority: 1. Key passed from App Settings (LocalStorage) 2. Key from Build Environment
  const keyToUse = apiKey || process.env.API_KEY;

  if (!keyToUse) {
     return "กรุณาตั้งค่า API KEY ก่อนใช้งาน (ไปที่ปุ่มเฟือง -> Login -> ใส่ Gemini API Key)";
  }

  // Optimize token usage by sending a simplified menu list
  const simplifiedMenu = menu.map(m => `${m.name} (${m.price} THB) [${m.category}] - ${m.description || ''}`).join('\n');

  const prompt = `
    You are a helpful, cheerful waiter at a Thai restaurant called "ArhanDuan".
    Here is our current menu:
    ---
    ${simplifiedMenu}
    ---
    
    The customer asks: "${userQuery}"
    
    Please recommend 1-3 items from the menu that match their request. 
    Explain why you recommend them briefly.
    If the requested item is not on the menu, politely apologize and suggest the closest alternative.
    Answer in Thai. Keep it short and friendly.
  `;

  try {
    // Create a fresh client instance with the selected key
    const client = new GoogleGenAI({ apiKey: keyToUse });
    
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "ขออภัย ระบบขัดข้องชั่วคราว (AI Error)";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "ขออภัย ไม่สามารถเชื่อมต่อกับ AI ได้ในขณะนี้ (ตรวจสอบ API Key)";
  }
};