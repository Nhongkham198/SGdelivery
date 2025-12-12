import { GoogleGenAI } from "@google/genai";
import { MenuItem } from '../types';

let geminiClient: GoogleGenAI | null = null;

const getClient = () => {
  if (!geminiClient && process.env.API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return geminiClient;
};

export const getFoodRecommendation = async (userQuery: string, menu: MenuItem[]): Promise<string> => {
  const client = getClient();
  if (!client) return "กรุณาตั้งค่า API KEY เพื่อใช้งาน AI (Please configure API Key)";

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
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "ขออภัย ระบบขัดข้องชั่วคราว (AI Error)";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "ขออภัย ไม่สามารถเชื่อมต่อกับ AI ได้ในขณะนี้";
  }
};