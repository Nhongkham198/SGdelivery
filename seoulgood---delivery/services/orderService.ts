
import { CartItem, LocationState } from '../types';

// *** สำคัญ: ให้เปลี่ยน URL นี้เป็น Web App URL ที่คุณได้จากการ Deploy Google Apps Script ***
// ตัวอย่าง: https://script.google.com/macros/s/AKfycbx.../exec
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz8Ws-ASYFdDPq3KeKJXbD2y0h5ZIfrrDYuIUP9xXu1P3X4UWmY0P2Z1hwa7jpu8QNP/exec'; 

export interface OrderSubmission {
  customerName: string;
  customerPhone: string;
  items: CartItem[];
  total: number;
  note?: string;
  location: LocationState | null;
}

export interface OrderResponse {
  result: 'success' | 'error';
  orderNo?: string; // e.g., "#01"
  error?: string;
}

export const saveOrderToSheet = async (order: OrderSubmission): Promise<OrderResponse> => {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('YOUR_GOOGLE_APPS_SCRIPT')) {
    console.warn("ยังไม่ได้ตั้งค่า Apps Script URL ระบบจะจำลองเลข Order ให้แทน");
    // Fallback สำหรับทดสอบถ้ายังไม่ได้ใส่ URL
    return { result: 'success', orderNo: '#TEST' }; 
  }

  try {
    // เตรียมข้อมูลส่งไป Backend
    const payload = {
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      items: order.items,
      total: order.total,
      note: order.items.map(i => i.note).filter(Boolean).join(', '), // รวม Note
      locationLink: order.location ? `https://www.google.com/maps?q=${order.location.lat},${order.location.lng}` : '',
    };

    // การส่งข้อมูลไปยัง Google Apps Script
    // หมายเหตุ: Apps Script Web App ต้อง Deploy เป็น "Anyone" ถึงจะรับ Request จากเว็บภายนอกได้โดยไม่ติด CORS
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
      // ไม่ต้องใส่ headers: { 'Content-Type': 'application/json' } เพื่อหลีกเลี่ยง Preflight (OPTIONS) request
    });

    // อ่าน Response text ก่อนเพื่อกันกรณีที่ Server ส่ง HTML Error มา (เช่น 404/500)
    const textResponse = await response.text();
    
    try {
        const data = JSON.parse(textResponse);
        return data;
    } catch (jsonError) {
        console.warn("ได้รับ Response ที่ไม่ใช่ JSON:", textResponse);
        // ถ้า Response เป็น OK (200) แต่ไม่ใช่ JSON อาจจะถือว่าส่งสำเร็จแบบไม่มีเลข Order หรือไม่
        if (response.ok) {
            // กรณีนี้อาจจะเกิดจาก Apps Script return text/plain หรือ html
             return { result: 'success', orderNo: '(บันทึกแล้ว)' };
        }
        return { result: 'error', error: 'Server Response Error: ' + textResponse.substring(0, 100) };
    }

  } catch (error) {
    console.error("Error saving order:", error);
    return { result: 'error', error: 'ไม่สามารถเชื่อมต่อกับ Server ได้' };
  }
};
