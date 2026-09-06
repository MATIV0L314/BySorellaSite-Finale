export interface Product {
  id?: string | number;
  name: string;
  description: string;
  price: number;
  discount_percentage?: number;
  category?: string; // Keep for backward compatibility if needed, but we'll use categories
  categories: string[];
  stock: number;
  sizes: string[];
  colors: string[];
  fragrances: string[];
  image_url: string;
  cover_image_url?: string;
  gallery?: string[];
  filters?: Record<string, string>; // e.g., { "Edad": "Adultos", "Tipo de cuello": "Redondo" }
  created_at?: string;
}

export interface Filter {
  id?: string;
  name: string; // e.g., "Edad", "Tipo de cuello"
  options: string[]; // e.g., ["Adultos", "Bebés", "Niños"]
}

export interface Category {
  id?: string | number;
  name: string;
  image_url: string;
  description: string;
  gallery?: string[];
  is_protected?: boolean;
}

export interface Banner {
  id?: string | number;
  title: string;
  subtitle: string;
  button_text: string;
  button_link: string;
  image_url: string;
  is_fixed: boolean;
  order_index: number;
  style?: 'split-right' | 'split-left' | 'full-width';
}

export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  link: string;
  type: 'category' | 'custom';
}

export interface BusinessHours {
  enabled: boolean;
  start: string;
  end: string;
  days: number[];
}

export interface Coupon {
  id?: string;
  code: string;
  discount_percentage: number;
  valid_from: string;
  valid_until: string;
  min_purchase_amount?: number;
  usage_limit?: number;
  usage_count: number;
  applicable_categories?: string[];
  applicable_products?: string[];
  active: boolean;
  description?: string;
}

export interface Settings {
  whatsapp_number: string;
  whatsapp_link?: string;
  admin_password: string;
  featured_category?: string;
  featured_layout?: string;
  lanzamientos_category?: string;
  mercadopago_public_key?: string;
  mercadopago_access_token?: string;
  announcement_text?: string;
  announcement_bg?: string;
  announcement_text_color?: string;
  announcement_enabled?: string;
  logo_url?: string;
  logo_url_dark?: string;
  logo_text?: string;
  logo_enabled?: string;
  menu_items?: string; // Stored as JSON string in DB
  business_hours?: string; // Stored as JSON string in DB
  gemini_api_key?: string;
  admin_email?: string;
  chatbot_name?: string;
  chatbot_unavailable_message?: string;
  shipping_caba_sucursal?: string;
  shipping_caba_domicilio?: string;
  shipping_nacional_sucursal?: string;
  shipping_nacional_domicilio?: string;
  smtp_user?: string;
  smtp_pass?: string;
  cursor_type?: string;
  cursor_speed?: string;
  maintenance_mode?: boolean;
  maintenance_message?: string;
  maintenance_image?: string;
  maintenance_bg_color?: string;
  maintenance_text_color?: string;
  maintenance_blur?: number;
}

export interface Order {
  id?: string | number;
  order_number: string;
  customer_email: string;
  customer_name: string;
  customer_phone: string;
  shipping_address: string;
  shipping_method: 'Recoger pedido' | 'Envio a domicilio';
  receiver_dni?: string;
  receiver_first_name?: string;
  receiver_last_name?: string;
  total: number;
  items: any[];
  status: string;
  created_at?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'client';
  phone?: string;
  address?: string;
  city?: string;
  dni?: string;
  created_at?: string;
  last_login?: string;
}

export interface Review {
  id?: string;
  productId: string | number;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: any;
}

export interface WishlistItem {
  id?: string;
  userId: string;
  productId: string | number;
  createdAt: string;
}
