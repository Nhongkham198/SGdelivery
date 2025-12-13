
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const net = require('net');
const iconv = require('iconv-lite'); // สำหรับแปลงภาษาไทย

// --- การตั้งค่า (แก้ไขตรงนี้ให้ตรงกับเครื่องพิมพ์ของคุณ) ---
const PRINTER_CONFIG = {
    host: '192.168.1.200', // <--- ใส่ IP ของเครื่องพิมพ์ใบเสร็จที่นี่ (เช่น 192.168.1.200)
    port: 9100,            // พอร์ตมาตรฐานของเครื่องพิมพ์ใบเสร็จส่วนใหญ่คือ 9100
    width: 42              // จำนวนตัวอักษรต่อบรรทัด (42 สำหรับ 80mm, 32 สำหรับ 58mm)
};

const SERVER_PORT = 3000; // พอร์ตของ Server นี้ (ที่จะเอาไปใส่ในหน้าตั้งค่า POS)

const app = express();
app.use(cors()); // อนุญาตให้ Vercel เรียกใช้งานได้
app.use(bodyParser.json());

// คำสั่งมาตรฐาน ESC/POS
const ESC = '\x1b';
const GS = '\x1d';
const COMMANDS = {
    INIT: ESC + '@',
    CUT: GS + 'V' + '\x41' + '\x00',
    TEXT_NORMAL: ESC + '!' + '\x00',
    TEXT_DOUBLE_HEIGHT: ESC + '!' + '\x10',
    TEXT_DOUBLE_WIDTH: ESC + '!' + '\x20',
    TEXT_BIG: ESC + '!' + '\x30',
    ALIGN_LEFT: ESC + 'a' + '\x00',
    ALIGN_CENTER: ESC + 'a' + '\x01',
    ALIGN_RIGHT: ESC + 'a' + '\x02',
    CODE_PAGE_THAI: ESC + 't' + '\x15' // ลองเปลี่ยน \x15 เป็นค่าอื่นหากภาษาไทยเพี้ยน (ขึ้นอยู่กับยี่ห้อ)
};

// Route สำหรับตรวจสอบว่า Server ทำงานอยู่ไหม
app.get('/', (req, res) => {
    res.send('Print Server is Running... Ready to connect!');
});

// Route สำหรับรับคำสั่งพิมพ์จาก POS
app.post('/print', (req, res) => {
    const { order, paperSize } = req.body;
    
    console.log(`[${new Date().toLocaleTimeString()}] Received print job #${order.orderId}`);

    // เชื่อมต่อกับเครื่องพิมพ์
    const client = new net.Socket();
    
    client.connect(PRINTER_CONFIG.port, PRINTER_CONFIG.host, () => {
        console.log('Connected to printer at ' + PRINTER_CONFIG.host);
        
        // 1. ส่งคำสั่งเริ่มต้น (Init)
        client.write(Buffer.from(COMMANDS.INIT));
        
        // 2. วนลูปข้อมูลแต่ละบรรทัดที่ส่งมาจาก Frontend
        if (order.items && Array.isArray(order.items)) {
            order.items.forEach(line => {
                // แปลงข้อความเป็น TIS-620 (ภาษาไทย)
                const encodedLine = iconv.encode(line + '\n', 'tis620');
                client.write(encodedLine);
            });
        }

        // 3. ส่งคำสั่งตัดกระดาษ (Cut)
        client.write(Buffer.from('\n\n\n')); // Feed กระดาษเปล่านิดหน่อย
        client.write(Buffer.from(COMMANDS.CUT));

        // 4. ปิดการเชื่อมต่อ
        client.end();
    });

    client.on('error', (err) => {
        console.error('Printer Connection Error:', err.message);
        res.status(500).json({ success: false, error: 'ไม่สามารถเชื่อมต่อเครื่องพิมพ์ได้: ' + err.message });
    });

    client.on('close', () => {
        console.log('Printer connection closed');
        // ตอบกลับไปที่ POS ว่าพิมพ์สำเร็จ (ต้องตอบกลับก่อน connection ปิดจริง หรือใน callback write ก็ได้)
        if (!res.headersSent) {
             res.json({ success: true });
        }
    });
});

app.listen(SERVER_PORT, () => {
    console.log(`\n=== POS PRINT SERVER STARTED ===`);
    console.log(`listening on port: ${SERVER_PORT}`);
    console.log(`Target Printer: ${PRINTER_CONFIG.host}:${PRINTER_CONFIG.port}`);
    console.log(`\nวิธีใช้งาน:`);
    console.log(`1. เปิดโปรแกรม POS บนมือถือ/คอม`);
    console.log(`2. ไปที่ "ตั้งค่า" -> "เครื่องพิมพ์ครัว"`);
    console.log(`3. ใส่ IP ของคอมพิวเตอร์เครื่องนี้ (เช่น 192.168.1.xx) และ Port ${SERVER_PORT}`);
    console.log(`================================\n`);
});
