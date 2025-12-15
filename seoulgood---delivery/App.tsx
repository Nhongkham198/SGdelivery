
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, MapPin, Send, MessageSquare, X, Plus, Minus, Loader2, ChevronDown, QrCode, Upload, Image as ImageIcon, Trash2, ThumbsUp, Copy, Check, Store, RotateCcw, Printer, Settings, Lock, Clock, Bike, UserPlus, AlertCircle } from 'lucide-react';
import { MenuItem, CartItem, LocationState, AppConfig } from './types';
import { fetchMenuFromSheet } from './services/menuService';
import { saveOrderToSheet } from './services/orderService';
import { checkServerHealth, sendToPrintServer } from './services/printerService';
import { MapPicker } from './components/MapPicker';

// --- Assets ---
// Custom SeoulGood Logo (Recreated as SVG based on user image) - Default value
const DEFAULT_LOGO = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 140"><rect width="350" height="140" rx="20" fill="black"/><text x="25" y="60" fill="%23DC2626" font-family="Arial, sans-serif" font-weight="900" font-size="45">SEOUL</text><text x="25" y="110" fill="%23DC2626" font-family="Arial, sans-serif" font-weight="900" font-size="45">GOOD</text><text x="175" y="110" fill="white" font-family="Arial, sans-serif" font-weight="bold" font-size="28">โซลกู๊ด 서울굿</text><path d="M210 40 C210 20, 290 20, 290 40 L280 90 C280 110, 220 110, 220 90 Z" fill="%23D97706"/><path d="M200 45 L210 40 M290 40 L300 45" stroke="%23F59E0B" stroke-width="6" stroke-linecap="round"/><ellipse cx="250" cy="40" rx="40" ry="10" fill="%23FCD34D"/></svg>`;

// QR Code Placeholder - Default value
const DEFAULT_QR = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=PromptPay-SeoulGood-Payment&color=000000&bgcolor=ffffff";

// Helper for Safe Local Storage Access
const getSafeStorage = (key: string) => {
  try {
    const item = localStorage.getItem(key);
    if (item === 'null' || item === 'undefined' || item === '') return null;
    return item;
  } catch (e) {
    return null;
  }
};

// Helper for Safe JSON Storage Access
const getJsonStorage = <T,>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    if (!item || item === 'undefined' || item === 'null') return defaultValue;
    return JSON.parse(item);
  } catch (e) {
    return defaultValue;
  }
};

// Helper: Compress Image
const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            // Compress to JPEG with 0.7 quality
            resolve(canvas.toDataURL('image/jpeg', 0.7)); 
        } else {
            reject(new Error("Canvas context is null"));
        }
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// Helper: Copy Image to Clipboard (Handles iOS/Android compatibility by converting to PNG Blob)
const copyImageToClipboard = async (imageSrc: string) => {
    try {
        // Check availability
        if (!navigator.clipboard?.write) return false;

        const blob = await new Promise<Blob | null>((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = imageSrc;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    // Clipboard API prefers PNG
                    canvas.toBlob(resolve, 'image/png');
                } else {
                    resolve(null);
                }
            };
            img.onerror = () => resolve(null);
        });

        if (blob) {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            return true;
        }
    } catch (error) {
        console.error("Clipboard Error:", error);
    }
    return false;
};

interface ShopStatus {
    isOpen: boolean;
    message: string;
}

// --- Time Check Logic (Advanced) ---
const getShopStatus = (config: AppConfig): ShopStatus => {
    // 0. Master Switch (Manual Close) - Highest Priority
    if (config.isManualClose) {
        return { isOpen: false, message: 'ร้านปิดชั่วคราว (Closed)' };
    }

    const now = new Date();
    const dayIndex = now.getDay(); // 0 = Sun, 1 = Mon, ...
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
    
    // 1. Check Specific Daily Schedule
    if (config.schedules && config.schedules[dayIndex]) {
        const schedule = config.schedules[dayIndex];
        
        if (schedule.isClosed) {
            return { isOpen: false, message: `ร้านปิดทุกวัน${dayNames[dayIndex]}` };
        }

        if (schedule.open && schedule.close) {
            const [openH, openM] = schedule.open.split(':').map(Number);
            const [closeH, closeM] = schedule.close.split(':').map(Number);
            const openMins = openH * 60 + openM;
            const closeMins = closeH * 60 + closeM;

            let isOpen = false;
            // Handle overnight
            if (closeMins < openMins) {
                isOpen = currentMins >= openMins || currentMins < closeMins;
            } else {
                isOpen = currentMins >= openMins && currentMins < closeMins;
            }

            if (!isOpen) return { isOpen: false, message: `วันนี้เปิด ${schedule.open} - ${schedule.close} น.` };
            return { isOpen: true, message: `เปิดทำการ (วันนี้ ${schedule.open} - ${schedule.close})` };
        }
    }

    // 2. Fallback to Default Global Schedule
    if (config.openTime && config.closeTime) {
        const [openH, openM] = config.openTime.split(':').map(Number);
        const [closeH, closeM] = config.closeTime.split(':').map(Number);
        const openMins = openH * 60 + openM;
        const closeMins = closeH * 60 + closeM;
        
        let isOpen = false;
        if (closeMins < openMins) {
            isOpen = currentMins >= openMins || currentMins < closeMins;
        } else {
            isOpen = currentMins >= openMins && currentMins < closeMins;
        }

        if (!isOpen) return { isOpen: false, message: `ร้านปิด (เวลาทำการปกติ ${config.openTime} - ${config.closeTime})` };
        return { isOpen: true, message: `เปิดทำการ (${config.openTime} - ${config.closeTime})` };
    }

    // 3. No Config = Always Open
    return { isOpen: true, message: '' };
};


const App: React.FC = () => {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Persistent States
  const [cart, setCart] = useState<CartItem[]>(() => getJsonStorage('cart_items', []));
  const [isCartOpen, setIsCartOpen] = useState(() => getJsonStorage('is_cart_open', false));
  const [selectedCategory, setSelectedCategory] = useState<string>(() => getSafeStorage('selected_category') || 'All');
  
  const [customerName, setCustomerName] = useState(() => getSafeStorage('customer_name') || '');
  const [customerPhone, setCustomerPhone] = useState(() => getSafeStorage('customer_phone') || '');
  const [location, setLocation] = useState<LocationState | null>(() => getJsonStorage('customer_location', null));
  const [slipPreview, setSlipPreview] = useState<string | null>(() => getSafeStorage('payment_slip'));
  
  // Configurable Images State
  const [sheetConfig, setSheetConfig] = useState<AppConfig>({});
  
  const [localLogo] = useState(() => getSafeStorage('app_logo'));
  const [localQr] = useState(() => getSafeStorage('app_qr'));
  const [localLineId] = useState(() => getSafeStorage('app_line_id'));

  // Printer State
  const [printerUrl, setPrinterUrl] = useState(() => getSafeStorage('printer_url') || 'http://localhost:3000');
  const [isPrinterOnline, setIsPrinterOnline] = useState(false);
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  
  // Printer Auth State
  const [isPrinterAuth, setIsPrinterAuth] = useState(false);
  const [printerPinInput, setPrinterPinInput] = useState('');

  // Banner Animation State
  const [bannerIndex, setBannerIndex] = useState(0);
  const [bannerFade, setBannerFade] = useState(true);

  const cleanLineId = (id: string | undefined | null) => {
      if (!id) return '';
      let str = id.trim();
      if (str.includes('line.me')) {
          const parts = str.split('/');
          str = parts[parts.length - 1].split('?')[0];
      }
      return str;
  }

  const finalLogoUrl = localLogo || sheetConfig.logoUrl || DEFAULT_LOGO;
  const finalQrUrl = localQr || sheetConfig.qrCodeUrl || DEFAULT_QR;
  const finalLineId = cleanLineId(localLineId || sheetConfig.lineOaId);

  // Shop Status
  const [shopStatus, setShopStatus] = useState<ShopStatus>({ isOpen: true, message: '' });

  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [tempQuantity, setTempQuantity] = useState(1);
  const [tempNote, setTempNote] = useState('');
  const [tempSelectedOptions, setTempSelectedOptions] = useState<Record<string, string>>({});
  
  const [isProcessingSlip, setIsProcessingSlip] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false); 
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string>('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- PERSISTENCE EFFECTS ---
  useEffect(() => { localStorage.setItem('cart_items', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('is_cart_open', JSON.stringify(isCartOpen)); }, [isCartOpen]);
  useEffect(() => { localStorage.setItem('selected_category', selectedCategory); }, [selectedCategory]);
  useEffect(() => { localStorage.setItem('customer_name', customerName); }, [customerName]);
  useEffect(() => { localStorage.setItem('customer_phone', customerPhone); }, [customerPhone]);
  useEffect(() => { localStorage.setItem('customer_location', JSON.stringify(location)); }, [location]);
  
  useEffect(() => {
    if (slipPreview) {
        try { 
            localStorage.setItem('payment_slip', slipPreview); 
        } catch (e) { 
            console.warn("Slip image too large for local storage"); 
        }
    } else {
        localStorage.removeItem('payment_slip');
    }
  }, [slipPreview]);

  useEffect(() => {
    const loadData = async () => {
      const data = await fetchMenuFromSheet();
      setMenu(data.items);
      setSheetConfig(data.config);
      setShopStatus(getShopStatus(data.config)); // Initial check
      setLoading(false);
    };
    loadData();
  }, []);

  // Periodic Check for Open/Close status (every minute)
  useEffect(() => {
     const interval = setInterval(() => {
         setShopStatus(getShopStatus(sheetConfig));
     }, 60000);
     return () => clearInterval(interval);
  }, [sheetConfig]);

  // --- BANNER ANIMATION LOGIC ---
  useEffect(() => {
    const interval = setInterval(() => {
        setBannerFade(false); // Start Fade Out
        setTimeout(() => {
            setBannerIndex((prev) => (prev === 0 ? 1 : 0)); // Switch Message
            setBannerFade(true); // Start Fade In
        }, 500); // Wait for fade out to complete (0.5s)
    }, 4500); // Total cycle time (4.5s)
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
      if (showConfirmModal) setCopyStatus('idle');
  }, [showConfirmModal]);

  // --- Auto Check Printer Server Health ---
  useEffect(() => {
      const checkStatus = async () => {
          const status = await checkServerHealth(printerUrl);
          setIsPrinterOnline(status);
      };
      
      // Initial Check
      checkStatus();
      
      // Periodic Check every 5 seconds
      const interval = setInterval(checkStatus, 5000);
      return () => clearInterval(interval);
  }, [printerUrl]);

  const filteredMenu = useMemo(() => {
    if (selectedCategory === 'All') return menu;
    return menu.filter(item => item.category === selectedCategory);
  }, [menu, selectedCategory]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(menu.map(item => item.category))).filter(Boolean);
    return ['All', ...cats];
  }, [menu]);

  const openItemModal = (item: MenuItem) => {
    setSelectedItem(item);
    setTempQuantity(1);
    setTempNote('');
    
    const defaultOpts: Record<string, string> = {};
    if (item.options) {
      item.options.forEach(opt => {
        if (opt.choices.length > 0) {
          defaultOpts[opt.name] = opt.choices[0].name;
        }
      });
    }
    setTempSelectedOptions(defaultOpts);
  };

  const closeItemModal = () => {
    setSelectedItem(null);
  };

  const handleOptionChange = (optionName: string, choice: string) => {
    setTempSelectedOptions(prev => ({
      ...prev,
      [optionName]: choice
    }));
  };

  const resetModal = () => {
      if(selectedItem) openItemModal(selectedItem);
  };

  const getPriceWithOptions = (item: MenuItem, selectedOpts: Record<string, string>) => {
      let finalPrice = item.price;
      if (!item.options) return finalPrice;
      
      Object.entries(selectedOpts).forEach(([optName, choiceName]) => {
          const option = item.options?.find(o => o.name === optName);
          const choice = option?.choices.find(c => c.name === choiceName);
          if (choice) {
              finalPrice += choice.priceModifier;
          }
      });
      return finalPrice;
  };

  const confirmAddToCart = () => {
    if (!selectedItem) return;
    
    const optionsKey = JSON.stringify(tempSelectedOptions);
    const finalUnitPrice = getPriceWithOptions(selectedItem, tempSelectedOptions);

    setCart(prev => {
      const existingIndex = prev.findIndex(
        i => i.id === selectedItem.id && 
             i.note === tempNote && 
             JSON.stringify(i.selectedOptions) === optionsKey
      );

      if (existingIndex >= 0) {
        const newCart = [...prev];
        newCart[existingIndex].quantity += tempQuantity;
        newCart[existingIndex].price = finalUnitPrice;
        return newCart;
      }

      return [...prev, { 
        ...selectedItem, 
        price: finalUnitPrice, 
        quantity: tempQuantity, 
        note: tempNote,
        selectedOptions: { ...tempSelectedOptions }
      }];
    });

    closeItemModal();
  };

  const removeFromCart = (index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart(prev => prev.map((item, i) => {
      if (i === index) {
        const newQ = item.quantity + delta;
        return newQ > 0 ? { ...item, quantity: newQ } : item;
      }
      return item;
    }));
  };

  const handleSlipChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        setIsProcessingSlip(true);
        try {
            const compressedDataUrl = await compressImage(file);
            setSlipPreview(compressedDataUrl);
        } catch (error) {
            console.error("Image compression failed", error);
            alert("ไม่สามารถประมวลผลรูปภาพได้ กรุณาลองใหม่อีกครั้ง");
        } finally {
            setIsProcessingSlip(false);
        }
    }
  };

  const removeSlip = () => {
      setSlipPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePrinterUrlSave = () => {
      localStorage.setItem('printer_url', printerUrl);
      setShowPrinterModal(false);
      // Trigger immediate check
      checkServerHealth(printerUrl).then(setIsPrinterOnline);
  };

  const handlePrinterLogin = () => {
      if (printerPinInput === '198') {
          setIsPrinterAuth(true);
      } else {
          alert("รหัสผ่านไม่ถูกต้อง (Incorrect PIN)");
          setPrinterPinInput('');
      }
  };

  // --- CALCULATIONS: GP Delivery Fee ---
  const gpPercentage = sheetConfig.gp || 0; // Default to 0 if not set in sheet
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const deliveryFee = Math.round(subtotal * (gpPercentage / 100)); // Calculate using GP
  const grandTotal = subtotal + deliveryFee;
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  const generateLineMessage = (orderIdOverride?: string) => {
    const displayOrderId = orderIdOverride || currentOrderId;
    let msg = `🛒 *New Order from SeoulGood* ${displayOrderId}\n\n`;
    msg += `👤 Customer: ${customerName}\n`;
    msg += `📞 Tel: ${customerPhone}\n`;
    msg += `📍 Location: ${location ? `https://www.google.com/maps?q=${location.lat},${location.lng}` : 'Not provided'}\n\n`;
    msg += `📋 *Items:*\n`;
    cart.forEach(item => {
      msg += `- ${item.name} x${item.quantity}`;
      if (item.selectedOptions && Object.keys(item.selectedOptions).length > 0) {
        const optStr = Object.entries(item.selectedOptions)
          .map(([key, val]) => `${key}: ${val}`)
          .join(', ');
        msg += `\n   (${optStr})`;
      }
      if (item.note) msg += `\n   Note: ${item.note}`;
      msg += `\n   ${item.price * item.quantity}฿\n`;
    });
    msg += `\n------------------`;
    msg += `\n💵 Subtotal: ${subtotal} THB`;
    msg += `\n🛵 Delivery Fee: ${deliveryFee} THB`;
    msg += `\n💰 *Grand Total: ${grandTotal} THB*`;
    msg += `\n------------------`;
    msg += `\n🧾 Payment Slip: (Attached in Chat)`;
    return encodeURIComponent(msg);
  };

  const sendToLine = async () => {
    // --- CHECK: SHOP OPEN STATUS ---
    if (!shopStatus.isOpen) {
        alert("ขออภัย ร้านปิดให้บริการ ไม่สามารถสั่งอาหารได้ในขณะนี้");
        return;
    }

    if (!customerName || !customerPhone || cart.length === 0) {
      alert("กรุณากรอกชื่อ เบอร์โทร และเลือกรายการอาหาร");
      return;
    }
    if (!slipPreview) {
        alert("กรุณาแนบสลิปการโอนเงินก่อนยืนยันออเดอร์");
        return;
    }
    setShowConfirmModal(true);
  };

  const handleCopySlip = async () => {
      if (!slipPreview) return;
      const success = await copyImageToClipboard(slipPreview);
      if (success) {
          setCopyStatus('success');
      } else {
          setCopyStatus('error');
          alert("อุปกรณ์นี้ไม่รองรับการคัดลอกอัตโนมัติ \n\n👉 กรุณา 'กดค้างที่รูปสลิป' แล้วเลือก 'คัดลอก' (Copy) หรือ 'บันทึก' (Save) เองนะครับ");
      }
  };

  const handleOpenLine = async () => {
        // --- TIME CHECK GUARD ---
        if (!shopStatus.isOpen) {
            alert(`⛔ ขออภัยครับ ร้านปิดให้บริการในขณะนี้ \n${shopStatus.message}\n\nกรุณาสั่งอาหารใหม่อีกครั้งในเวลาทำการครับ`);
            setShowConfirmModal(false);
            return; // CRITICAL: Stop here. Do not save to sheet. Do not open Line.
        }

        setIsSavingOrder(true);
        try {
            const result = await saveOrderToSheet({
                customerName,
                customerPhone,
                items: cart,
                total: grandTotal, // Save Grand Total to sheet
                location: location
            });
            
            let orderId = '(Offline)';
            if (result.result === 'success' && result.orderNo) {
                orderId = result.orderNo;
                setCurrentOrderId(result.orderNo);

                // --- Auto Print if Server is Online ---
                if (isPrinterOnline) {
                    try {
                        await sendToPrintServer({
                            orderId: orderId,
                            customerName,
                            customerPhone,
                            items: cart,
                            subtotal: subtotal,
                            deliveryFee: deliveryFee,
                            total: grandTotal,
                            note: '',
                            timestamp: new Date().toLocaleString('th-TH')
                        }, printerUrl);
                        console.log("Auto print command sent.");
                    } catch (printErr) {
                        console.error("Auto print failed:", printErr);
                    }
                }
            }

            const message = generateLineMessage(orderId);
            let targetUrl = '';
            if (finalLineId && finalLineId !== '') {
                targetUrl = `https://line.me/R/oaMessage/${finalLineId}/?${message}`;
            } else {
                targetUrl = `https://line.me/R/msg/text/?${message}`;
            }
            window.location.href = targetUrl;
            setTimeout(() => setShowConfirmModal(false), 2000);
        } catch (e) {
            alert("เกิดข้อผิดพลาดในการบันทึกออเดอร์");
        } finally {
            setIsSavingOrder(false);
        }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-orange-50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-orange-500 mx-auto mb-2" />
          <p className="text-orange-600 font-medium">กำลังโหลดเมนูอร่อยๆ...</p>
        </div>
      </div>
    );
  }

  const showStickyCart = cart.length > 0 && !isCartOpen && !selectedItem;

  return (
    <div className="min-h-screen pb-32 relative max-w-5xl mx-auto bg-gray-50 shadow-xl">
      
      {/* Sticky Header Group */}
      <div className="sticky top-0 z-50 bg-gray-50 shadow-md">
        
        {/* Closed Banner */}
        {!shopStatus.isOpen && (
            <div className="bg-red-500 text-white text-center py-2 px-4 text-sm font-bold shadow-inner flex items-center justify-center gap-2 animate-pulse">
                <Clock size={16} />
                <span>{shopStatus.message}</span>
            </div>
        )}

        <div className="bg-white">
            <header className="px-4 py-2 flex items-center gap-2">
                <div className="flex items-center gap-3 mr-auto">
                    <div className="h-16 w-auto flex items-center justify-center shadow-sm hover:scale-105 transition-transform">
                        <img src={finalLogoUrl} alt="SeoulGood Logo" className={`h-full w-auto object-contain drop-shadow-md ${!shopStatus.isOpen ? 'grayscale' : ''}`}/>
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-800 leading-none tracking-tight">SeoulGood</h1>
                        <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-orange-600 font-medium">ต้นตำหรับอาหารเกาหลี</p>
                            {shopStatus.isOpen ? (
                                <span className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0.5 rounded font-bold border border-green-200">OPEN</span>
                            ) : (
                                <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold border border-red-600">CLOSED</span>
                            )}
                        </div>
                    </div>
                </div>
                
                {/* --- REMOVED SMALL BADGE HERE --- */}

                <div className="flex gap-2 shrink-0 items-center">
                    {/* Printer Settings Button */}
                    <button 
                        onClick={() => {
                            setShowPrinterModal(true);
                            setIsPrinterAuth(false);
                            setPrinterPinInput('');
                        }}
                        className={`p-2 rounded-full border transition relative shadow-sm ${isPrinterOnline ? 'bg-white border-green-200 text-green-600 hover:bg-green-50' : 'bg-white border-red-200 text-red-400 hover:bg-red-50'}`}
                        title={isPrinterOnline ? "Printer Online" : "Printer Offline"}
                    >
                        <Printer size={20} />
                        <span className={`absolute top-0 right-0 -mt-1 -mr-1 w-3 h-3 rounded-full border-2 border-white ${isPrinterOnline ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    </button>

                    {finalLineId && (
                        <a href={`https://line.me/R/ti/p/${finalLineId}`} target="_blank" rel="noreferrer" className="p-2 rounded-full bg-[#06C755] text-white hover:bg-[#05b64d] transition flex items-center justify-center shadow-sm">
                            <MessageSquare size={22} />
                        </a>
                    )}
                </div>
            </header>

            <div className="border-b border-gray-100">
                <div className="flex overflow-x-auto no-scrollbar py-3 px-4 gap-3">
                    {categories.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setSelectedCategory(cat)}
                            className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                                selectedCategory === cat 
                                ? 'bg-orange-600 text-white shadow-md' 
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>
        </div>

        {/* --- MOVED: Animated Delivery Banner to Sticky Section --- */}
        <div className="px-4 pt-3 pb-1 bg-gray-50">
            <div className="relative group overflow-hidden rounded-2xl bg-gradient-to-r from-orange-500 via-red-500 to-orange-500 p-0.5 shadow-lg">
                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                
                {/* Content Container with Fade Transition */}
                <div 
                    className={`bg-white/10 backdrop-blur-sm rounded-xl py-3 flex items-center justify-center gap-2 text-white transition-opacity duration-500 ${bannerFade ? 'opacity-100' : 'opacity-0'}`}
                >
                     {/* Left Icon */}
                     <div className={`animate-bounce bg-white p-1.5 rounded-full shadow-sm ${bannerIndex === 1 ? 'text-[#06C755]' : 'text-orange-600'}`}>
                        {bannerIndex === 0 ? <Bike size={18} strokeWidth={2.5} /> : <UserPlus size={18} strokeWidth={2.5} />}
                     </div>
                     
                     {/* Text */}
                     <span className="font-extrabold text-xs md:text-base tracking-wide drop-shadow-sm text-center">
                        {bannerIndex === 0 ? "ระบบนี้ใช้เฉพาะการส่ง Delivery เท่านั้น" : "เพิ่มเป็นเพื่อนใน Line OA เพื่อสั่งอาหารในระบบ"}
                     </span>

                     {/* Right Icon */}
                     <div className={`animate-bounce bg-white p-1.5 rounded-full shadow-sm ${bannerIndex === 1 ? 'text-[#06C755]' : 'text-orange-600'}`} style={{ animationDelay: '150ms' }}>
                        {bannerIndex === 0 ? <Bike size={18} strokeWidth={2.5} className="scale-x-[-1]" /> : <UserPlus size={18} strokeWidth={2.5} />}
                     </div>
                </div>
            </div>
        </div>

      </div>

      {/* Printer Settings Modal */}
      {showPrinterModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                          <Printer size={20} className="text-orange-600"/> ตั้งค่าเครื่องพิมพ์ (Printer)
                      </h3>
                      <button onClick={() => setShowPrinterModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  </div>
                  
                  {!isPrinterAuth ? (
                    // --- PIN LOCK SCREEN ---
                    <div className="flex flex-col items-center justify-center py-4 animate-in fade-in">
                        <div className="bg-orange-100 p-4 rounded-full mb-4">
                            <Lock size={32} className="text-orange-600" />
                        </div>
                        <h4 className="text-gray-800 font-bold text-lg mb-1">กรุณาใส่รหัสผ่าน</h4>
                        <p className="text-gray-500 text-sm mb-4">สำหรับพนักงานเท่านั้น</p>
                        
                        <input 
                            type="password"
                            placeholder="PIN Code"
                            className="w-48 text-center text-2xl tracking-widest border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-orange-500 outline-none mb-4"
                            value={printerPinInput}
                            onChange={(e) => setPrinterPinInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handlePrinterLogin()}
                            autoFocus
                        />
                        
                        <button 
                            onClick={handlePrinterLogin}
                            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 rounded-lg transition"
                        >
                            เข้าสู่ระบบ (Login)
                        </button>
                    </div>
                  ) : (
                    // --- SETTINGS SCREEN (Unlocked) ---
                    <div className="animate-in fade-in">
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-gray-700 mb-1">🔌 Print Server URL:</label>
                            <input 
                                type="text" 
                                value={printerUrl} 
                                onChange={(e) => setPrinterUrl(e.target.value)}
                                className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                                placeholder="http://localhost:3000"
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <button onClick={handlePrinterUrlSave} className="w-full bg-slate-700 hover:bg-slate-800 text-white py-2 rounded font-bold transition">
                                บันทึก IP (Save)
                            </button>
                        </div>

                        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${isPrinterOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                            <span className={`text-sm font-medium ${isPrinterOnline ? 'text-green-600' : 'text-red-500'}`}>
                                {isPrinterOnline ? 'เชื่อมต่อ Server สำเร็จ' : 'เชื่อมต่อ Server ไม่ได้'}
                            </span>
                        </div>
                        {!isPrinterOnline && (
                            <p className="text-[10px] text-center text-gray-400 mt-2">
                                * ตรวจสอบว่าเปิดโปรแกรม server.js หรือยัง <br/>
                                * ตรวจสอบว่า IP ถูกต้องหรือไม่
                            </p>
                        )}
                    </div>
                  )}
              </div>
          </div>
      )}

      {/* Menu List */}
      <main className="p-4 max-w-4xl mx-auto pt-2">
        
        {/* --- Removed Banner from here --- */}

        {!loading && menu.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-red-100 p-6">
                <Store size={48} className="mx-auto text-red-300 mb-4"/>
                <h3 className="text-xl font-bold text-gray-800 mb-2">ไม่พบรายการอาหาร</h3>
                <p className="text-gray-500 mb-4">
                    ระบบไม่สามารถดึงข้อมูลเมนูจาก Google Sheet ได้
                </p>
                <a href={`https://docs.google.com/spreadsheets/d/${'1Oz0V5JU9o67v84qCmPK3h39fEq5_KQmKdjyzAR777ow'}`} target="_blank" rel="noreferrer" className="text-orange-600 underline text-sm hover:text-orange-800">
                    ตรวจสอบไฟล์ Google Sheet
                </a>
            </div>
        )}

        <div className="space-y-4">
          {filteredMenu.map(item => (
            <div key={item.id} onClick={() => openItemModal(item)} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex gap-3 hover:shadow-md transition cursor-pointer active:scale-[0.99] relative overflow-hidden">
              <div className="w-24 h-24 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 relative">
                 <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                 {item.isSpicy && <span className="absolute top-1 right-1 bg-red-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold shadow-sm z-10">Spicy</span>}
                 {item.isRecommended && (
                     <div className="absolute top-2 left-2 z-10">
                        <div className="bg-yellow-400 text-red-600 p-1.5 rounded-full shadow-lg border-2 border-white animate-bounce flex items-center justify-center">
                           <ThumbsUp size={18} strokeWidth={3} fill="currentColor" />
                        </div>
                     </div>
                 )}
              </div>
              <div className="flex-1 flex flex-col justify-between">
                <div>
                    <div className="flex justify-between items-start">
                        <h3 className="font-bold text-gray-800 leading-tight line-clamp-2">{item.name}</h3>
                        <span className="font-bold text-orange-600 whitespace-nowrap ml-2">{item.price} ฿</span>
                    </div>
                    <p className="text-gray-400 text-xs mt-1 line-clamp-2">{item.description}</p>
                    {item.options && item.options.length > 0 && (
                      <p className="text-orange-500 text-[10px] mt-1 bg-orange-50 inline-block px-1 rounded">มีตัวเลือกเพิ่มเติม</p>
                    )}
                </div>
                <div className="flex justify-end mt-2">
                    <button className="bg-orange-50 text-orange-600 w-8 h-8 rounded-full flex items-center justify-center hover:bg-orange-100 transition"><Plus size={18} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* STICKY BOTTOM BAR */}
      {showStickyCart && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] p-4 animate-in slide-in-from-bottom duration-300">
            <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
                <div className="flex flex-col">
                    <div className="flex items-center gap-2 text-gray-600">
                        <div className="bg-orange-100 text-orange-600 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">{totalItems}</div>
                        <span className="text-sm">รายการในตะกร้า</span>
                    </div>
                    {/* Display GRAND TOTAL in sticky bar */}
                    <span className="text-2xl font-bold text-orange-600 leading-tight">{grandTotal} ฿</span>
                </div>
                <button 
                    onClick={() => setIsCartOpen(true)}
                    className="flex-1 max-w-[200px] bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-xl font-bold text-lg shadow-lg active:scale-95 transition flex items-center justify-center gap-2"
                >
                    <ShoppingCart size={20} className="fill-white/20" /> ดูตะกร้า
                </button>
            </div>
        </div>
      )}

      {/* Item Detail Modal */}
      {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-md rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 relative flex flex-col max-h-[90vh]">
                  <div className="p-4 border-b border-gray-100 flex gap-4 relative">
                      <button onClick={closeItemModal} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition">
                          <X size={24} />
                      </button>
                      <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 border border-gray-100 relative">
                          <img src={selectedItem.image} alt={selectedItem.name} className="w-full h-full object-cover"/>
                      </div>
                      <div className="flex-1 pr-6 pt-1">
                          <h2 className="text-xl font-bold text-gray-800 leading-tight">{selectedItem.name}</h2>
                          <p className="text-gray-500 text-sm mt-1">ราคาเริ่มต้น {selectedItem.price} ฿</p>
                      </div>
                  </div>
                  <div className="p-5 overflow-y-auto flex-1 bg-white">
                      {selectedItem.options && selectedItem.options.map((option, idx) => (
                        <div key={idx} className="mb-6">
                          <h4 className="font-bold text-gray-800 text-lg mb-3 flex items-center gap-1">
                            {option.name} <span className="text-red-500">*</span>
                          </h4>
                          <div className="space-y-3">
                            {option.choices.map((choice) => {
                              const isSelected = tempSelectedOptions[option.name] === choice.name;
                              return (
                                <label key={choice.name} className={`flex items-center p-3 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'border-orange-500 bg-white ring-0' : 'border-gray-100 hover:border-gray-200'}`}>
                                  <div className={`w-5 h-5 rounded-full border-2 mr-3 flex items-center justify-center ${isSelected ? 'border-orange-500' : 'border-gray-300'}`}>
                                      {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />}
                                  </div>
                                  <span className="text-gray-700 text-base">
                                    {choice.name} {choice.priceModifier > 0 && <span className="text-orange-500 text-sm ml-1 font-semibold">(+{choice.priceModifier}฿)</span>}
                                  </span>
                                  <input type="radio" name={`opt-${selectedItem.id}-${option.name}`} value={choice.name} checked={isSelected} onChange={() => handleOptionChange(option.name, choice.name)} className="hidden"/>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <div className="mb-4">
                          <label className="block text-lg font-bold text-gray-800 mb-2">หมายเหตุ (ถ้ามี):</label>
                          <textarea className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none resize-none" rows={3} placeholder="เช่น ไม่ใส่น้ำตาล, น้ำมันน้อย" value={tempNote} onChange={(e) => setTempNote(e.target.value)} />
                      </div>
                  </div>
                  <div className="p-4 bg-white border-t border-gray-100 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
                      <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                              <button onClick={() => setTempQuantity(q => Math.max(1, q - 1))} className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center font-bold text-xl shadow-md transition"><Minus size={18} /></button>
                              <span className="text-2xl font-bold text-gray-800 w-8 text-center">{tempQuantity}</span>
                              <button onClick={() => setTempQuantity(q => q + 1)} className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center font-bold text-xl shadow-md transition"><Plus size={18} /></button>
                          </div>
                          <button onClick={resetModal} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full"><RotateCcw size={20} /></button>
                          <button onClick={confirmAddToCart} className="bg-[#22c55e] hover:bg-[#16a34a] text-white px-4 py-3 rounded-lg font-bold text-lg shadow-lg transition flex-1 flex flex-col items-center justify-center leading-tight">
                              <span>เพิ่ม Order</span>
                              <span className="text-xs font-medium opacity-90">{getPriceWithOptions(selectedItem, tempSelectedOptions) * tempQuantity} ฿</span>
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Cart Modal */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col animate-in slide-in-from-bottom duration-300">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white shadow-sm shrink-0">
                <h2 className="text-xl font-bold flex items-center gap-2 text-gray-800">
                    <ShoppingCart className="text-orange-600" size={24}/> ตะกร้าสินค้า
                </h2>
                <button onClick={() => setIsCartOpen(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 text-gray-600 transition">
                    <ChevronDown size={28} />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50 pb-8">
                <div className="max-w-3xl mx-auto space-y-6">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-3 bg-orange-50 border-b border-orange-100 font-bold text-orange-800">รายการอาหาร ({totalItems})</div>
                        <div className="p-4 space-y-4">
                            {cart.length === 0 ? (
                                <div className="text-center py-8 text-gray-400">
                                    <ShoppingCart size={48} className="mx-auto mb-2 opacity-20"/>
                                    <p>ยังไม่มีสินค้าในตะกร้า</p>
                                </div>
                            ) : (
                                cart.map((item, index) => (
                                    <div key={index} className="flex gap-4 border-b border-gray-100 pb-4 last:border-0 last:pb-0 relative">
                                        <button onClick={() => removeFromCart(index)} className="absolute top-0 right-0 text-gray-300 hover:text-red-500 p-1"><X size={18} /></button>
                                        <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                                            <img src={item.image} alt={item.name} className="w-full h-full object-cover"/>
                                        </div>
                                        <div className="flex-1 pr-6">
                                            <h4 className="font-bold text-gray-800">{item.name}</h4>
                                            {item.selectedOptions && Object.keys(item.selectedOptions).length > 0 && (
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {Object.entries(item.selectedOptions).map(([key, val]) => (
                                                  <span key={key} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full border border-gray-200">{val}</span>
                                                ))}
                                              </div>
                                            )}
                                            {item.note && <p className="text-xs text-orange-600 italic mt-1">* {item.note}</p>}
                                            <div className="flex justify-between items-end mt-2">
                                                <p className="text-orange-600 font-bold">{item.price * item.quantity} ฿</p>
                                                <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-1 border border-gray-200">
                                                    <button onClick={() => item.quantity === 1 ? removeFromCart(index) : updateQuantity(index, -1)} className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600"><Minus size={14} /></button>
                                                    <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                                                    <button onClick={() => updateQuantity(index, 1)} className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600"><Plus size={14} /></button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {cart.length > 0 && (
                        <>
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                             <div className="p-3 bg-blue-50 border-b border-blue-100 font-bold text-blue-800 flex items-center gap-2"><MapPin size={18}/> ข้อมูลจัดส่ง</div>
                             <div className="p-4 space-y-4">
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อของคุณ</label>
                                        <input type="text" placeholder="ระบุชื่อ" className="w-full p-3 bg-gray-50 border border-gray-200 focus:bg-white focus:border-orange-500 rounded-lg outline-none transition" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">เบอร์โทรศัพท์</label>
                                        <input type="tel" placeholder="ระบุเบอร์โทร" className="w-full p-3 bg-gray-50 border border-gray-200 focus:bg-white focus:border-orange-500 rounded-lg outline-none transition" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                                    </div>
                                 </div>
                                 <div>
                                     <label className="block text-sm font-medium text-gray-700 mb-1">ปักหมุดจุดส่ง</label>
                                     <div className="rounded-lg overflow-hidden border border-gray-200 h-[450px]">
                                         <MapPicker onLocationSelect={setLocation} initialLocation={location} />
                                     </div>
                                 </div>
                             </div>
                        </div>
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-4">
                            <div className="p-3 bg-green-50 border-b border-green-100 font-bold text-green-800 flex items-center gap-2"><QrCode size={18}/> ชำระเงิน (Payment)</div>
                            <div className="p-4 flex flex-col items-center">
                                
                                {/* --- NEW: Payment Confirmation Notice --- */}
                                <div className="w-full bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-center">
                                    <p className="text-xs text-blue-800 leading-relaxed">
                                        <span className="font-bold inline-flex items-center gap-1"><AlertCircle size={12}/> คำชี้แจง:</span> ระบบการสั่งอาหารจะสมบูรณ์ก็ต่อเมื่อลูกค้าชำระเงินผ่าน QR code ของทางร้านเท่านั้น และระบบจะติดต่อกลับทาง Line OA เพื่อแจ้งยืนยันรับยอดค่ะ
                                    </p>
                                </div>

                                <p className="text-sm text-gray-600 mb-3 text-center">สแกน QR Code เพื่อชำระเงิน</p>
                                <div className="w-56 h-auto bg-white p-3 border border-gray-200 rounded-lg shadow-sm mb-4">
                                    <img src={finalQrUrl} alt="Payment QR Code" className="w-full h-full object-contain" />
                                </div>
                                <p className="text-xs text-gray-400 mb-4">PromptPay</p>
                                <div className="w-full max-w-sm">
                                    {/* --- UPDATED: Hide upload when closed --- */}
                                    {!shopStatus.isOpen ? (
                                        <div className="w-full h-32 border-2 border-red-100 bg-red-50 rounded-xl flex flex-col items-center justify-center text-red-500 gap-2 opacity-75 cursor-not-allowed">
                                            <Lock size={32} />
                                            <div className="text-center">
                                                <p className="font-bold text-sm">ร้านปิดให้บริการ</p>
                                                <p className="text-xs">{shopStatus.message}</p>
                                            </div>
                                            <p className="text-[10px] bg-white px-2 py-0.5 rounded border border-red-100">ปิดรับชำระเงินชั่วคราว</p>
                                        </div>
                                    ) : (
                                        <>
                                            <label className="block text-sm font-bold text-gray-700 mb-2">แนบสลิปการโอนเงิน (Attach Slip) <span className="text-red-500">*</span></label>
                                            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleSlipChange} />
                                            {slipPreview ? (
                                                <div className="relative w-full border-2 border-green-500 border-dashed rounded-xl p-2 bg-green-50">
                                                    <div className="h-48 w-full rounded-lg overflow-hidden bg-white mb-2">
                                                        <img src={slipPreview} alt="Slip Preview" className="w-full h-full object-contain" />
                                                    </div>
                                                    <button onClick={removeSlip} className="w-full py-2 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition flex items-center justify-center gap-2 text-sm font-medium"><Trash2 size={16}/> ลบรูปภาพ / เลือกใหม่</button>
                                                    <div className="absolute top-0 right-0 -mt-2 -mr-2 bg-green-500 text-white rounded-full p-1 shadow-sm"><ImageIcon size={14}/></div>
                                                </div>
                                            ) : (
                                                <button onClick={() => fileInputRef.current?.click()} disabled={isProcessingSlip} className="w-full h-32 border-2 border-gray-300 border-dashed rounded-xl flex flex-col items-center justify-center text-gray-500 hover:border-orange-500 hover:text-orange-600 hover:bg-orange-50 transition gap-2 disabled:opacity-50">
                                                    {isProcessingSlip ? <Loader2 className="animate-spin text-orange-500" size={32}/> : <Upload size={32} className="opacity-50"/>}
                                                    <span className="text-sm font-medium">{isProcessingSlip ? 'กำลังประมวลผลรูปภาพ...' : 'กดเพื่อเลือกรูปสลิป'}</span>
                                                    <span className="text-[10px] text-gray-400">(ระบบจะย่อขนาดภาพอัตโนมัติ)</span>
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        </>
                    )}
                </div>
            </div>
            {cart.length > 0 && (
                <div className="p-4 bg-white border-t border-gray-100 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] shrink-0 z-50">
                    <div className="max-w-3xl mx-auto">
                        
                        {/* --- NEW: Summary Breakdown --- */}
                        <div className="flex justify-between text-gray-600 mb-2 text-sm">
                            <span>ค่าอาหาร (Subtotal)</span>
                            <span>{subtotal} ฿</span>
                        </div>
                        <div className="flex justify-between text-gray-600 mb-2 text-sm">
                            <span>ค่าจัดส่ง (Delivery Fee)</span>
                            <span>{deliveryFee} ฿</span>
                        </div>
                        {/* -------------------------------- */}

                        <div className="flex justify-between items-center mb-4 pt-2 border-t border-gray-100">
                            <span className="text-gray-800 font-bold text-lg">ยอดรวมทั้งหมด</span>
                            <span className="text-3xl font-bold text-orange-600">{grandTotal} ฿</span>
                        </div>
                        
                        {/* --- UPDATED: Disable confirm button when closed --- */}
                        <button 
                            onClick={sendToLine} 
                            disabled={!shopStatus.isOpen} 
                            className={`w-full text-white py-4 rounded-xl font-bold text-xl shadow-lg transition flex items-center justify-center gap-2 ${
                                !shopStatus.isOpen 
                                ? 'bg-gray-400 cursor-not-allowed' 
                                : 'bg-[#06C755] hover:bg-[#05b64d] active:scale-[0.98]'
                            }`}
                        >
                            {!shopStatus.isOpen ? (
                                <><Clock size={24} /> ร้านปิด (Closed)</>
                            ) : (
                                <><Send size={24} /> ยืนยันการสั่งทาง LINE</>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Confirmation Modal */}
            {showConfirmModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl relative">
                        <button onClick={() => setShowConfirmModal(false)} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 p-2"><X size={20} /></button>
                        
                        <div className="text-center mb-4">
                            <h3 className="font-bold text-xl text-gray-800">ขั้นตอนการส่ง (Steps)</h3>
                            <p className="text-xs text-gray-500">กรุณาทำตาม 2 ขั้นตอนง่ายๆ ด้านล่าง</p>
                        </div>
                        {currentOrderId && currentOrderId !== '(Offline)' && (
                            <div className="mb-3 text-center">
                                <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-sm font-bold border border-orange-200">Order ID: {currentOrderId}</span>
                            </div>
                        )}
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 mb-3">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="bg-orange-100 text-orange-600 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">1</div>
                                <span className="font-bold text-gray-700 text-sm">คัดลอกรูปสลิป (Copy Slip)</span>
                            </div>
                            <div className="flex gap-3">
                                <div className="w-16 h-16 bg-white rounded border border-gray-200 overflow-hidden shrink-0">
                                    <img src={slipPreview || ''} className="w-full h-full object-cover" />
                                </div>
                                <div className="flex-1 flex flex-col gap-1">
                                    <button onClick={handleCopySlip} className={`w-full flex-1 rounded-lg font-bold text-sm transition flex flex-col items-center justify-center gap-1 border ${copyStatus === 'success' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm'}`}>
                                        {copyStatus === 'success' ? <><Check size={20} className="text-green-600"/><span>คัดลอกแล้ว!</span></> : <><Copy size={18} className="text-gray-500"/><span>กดปุ่มเพื่อคัดลอก</span></>}
                                    </button>
                                    <span className="text-[10px] text-gray-400 text-center px-1">(หากปุ่มกดไม่ติด ให้กดค้างที่รูปเพื่อคัดลอก)</span>
                                </div>
                            </div>
                        </div>
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 mb-4">
                             <div className="flex items-center gap-2 mb-2">
                                <div className="bg-green-100 text-green-600 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">2</div>
                                <span className="font-bold text-gray-700 text-sm">ส่งเข้า LINE (Send)</span>
                            </div>
                            <p className="text-xs text-gray-500 ml-8 mb-2">กดปุ่มเปิด LINE แล้วกด <strong className="text-black">วาง (Paste)</strong> รูปในช่องแชท</p>
                        </div>
                        <div className="mb-4 text-xs text-center text-gray-600 bg-orange-50 p-2 rounded border border-orange-100">หลังจากระบบตรวจสอบสลิปการโอน แล้วพนักงานยืนยันการรับยอดโอนของลูกค้า อาหารของท่านรอ 15-20 นาที ทั้งนี้ขึ้นอยู่กับระยะและคิวของลูกค้าท่านอื่นๆ</div>
                        <button onClick={handleOpenLine} disabled={isSavingOrder} className={`w-full text-white py-3 rounded-xl font-bold shadow-lg active:scale-95 transition flex items-center justify-center gap-2 text-lg ${isSavingOrder ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#06C755] hover:bg-[#05b64d]'}`}>
                            {isSavingOrder ? <><Loader2 className="animate-spin" /> กำลังส่งออเดอร์...</> : <><Send size={20} /> เปิด LINE ส่งออเดอร์</>}
                        </button>
                    </div>
                </div>
            )}
        </div>
      )}
    </div>
  );
};

export default App;
