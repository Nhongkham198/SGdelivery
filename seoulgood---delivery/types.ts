export interface MenuChoice {
  name: string;
  priceModifier: number;
}

export interface MenuOption {
  name: string;      // e.g. "เนื้อสัตว์"
  choices: MenuChoice[]; // Updated to hold object with name and priceModifier
}

export interface MenuItem {
  id: string;
  category: string;
  name: string;
  price: number;
  description?: string;
  image?: string;
  isSpicy?: boolean;
  options?: MenuOption[]; // New field for options
}

export interface AppConfig {
  logoUrl?: string;
  qrCodeUrl?: string;
  lineOaId?: string; // New field for Line Official Account ID
}

export interface MenuData {
  items: MenuItem[];
  config: AppConfig;
}

export interface CartItem extends MenuItem {
  quantity: number;
  note?: string;
  selectedOptions?: Record<string, string>; // e.g. { "เนื้อสัตว์": "หมู" }
}

export interface LocationState {
  lat: number;
  lng: number;
  address?: string;
}

export interface OrderDetails {
  customerName: string;
  customerPhone: string;
  location: LocationState | null;
  items: CartItem[];
  total: number;
}