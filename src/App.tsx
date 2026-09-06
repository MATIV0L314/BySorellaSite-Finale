import React, { useState, useEffect, FormEvent, useMemo } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { ShoppingBag, Menu, X, Settings as SettingsIcon, MessageSquare, Send, Plus, Trash2, Edit, Save, Wand2, ArrowRight, Phone, Image as ImageIcon, Layout, List, Sun, Moon, Globe, Clock, LogIn, LogOut, User as UserIcon, ImagePlus, Zap, Camera, CameraOff, ChevronDown, Package, UserCircle, DollarSign, LayoutGrid, Instagram, Facebook, Calendar, Maximize, Palette, Check, Users, Search, Upload, Download, Paperclip, FileText, Mail, Tag, Filter as FilterIcon, Heart } from 'lucide-react';
import * as Icons from 'lucide-react';
import * as XLSX from 'xlsx';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Product, Settings, Category, Banner, Order, Coupon, UserProfile, Filter, Review, WishlistItem } from './types';
import AppCursor from './CustomCursor';
import { translations, Language } from './translations';
import { auth, signInWithGoogle, logout, db, saveUserProfile, createOrder, deleteOrder, createBuyerUser, getUserProfile, loginWithEmail, registerWithEmail, getProducts, saveProduct, deleteProduct, getCategories, saveCategory, deleteCategory, getBanners, saveBanner, deleteBanner, getSettings, saveSettings, updateOrderStatus, getUsers, updateUserRole, requestAdminAccess, getAdminRequests, updateAdminRequestStatus, getAdminRequestByEmail, getCoupons, saveCoupon, deleteCoupon, getFilters, saveFilter, deleteFilter, getReviews, addReview, getWishlist, addToWishlist, removeFromWishlist } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, where } from 'firebase/firestore';
import { initMercadoPago, Wallet, Payment } from '@mercadopago/sdk-react';

// Types
declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface CartItem extends Product {
  quantity: number;
  cartItemId?: string;
  selectedSize?: string;
  selectedColor?: string;
  selectedDynamicFilters?: Record<string, string>;
}

interface MenuItem {
  id: string;
  label: string;
  link: string;
  icon: string;
  type: 'category' | 'custom';
}

interface BusinessHours {
  enabled: boolean;
  start: string;
  end: string;
  days: number[];
}

// Initialize Gemini
let globalGeminiKey = '';
const getApiKey = () => {
  if (globalGeminiKey) return globalGeminiKey;
  try {
    return process.env.GEMINI_API_KEY || 'AIzaSyBIu8U_9WiL1yt4zAz-_gmBqabPijzkNdo';
  } catch {
    return 'AIzaSyBIu8U_9WiL1yt4zAz-_gmBqabPijzkNdo';
  }
};

const compressBase64Image = (base64Str: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
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
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = base64Str;
  });
};

const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
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
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
};

const safeSetLocalStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Could not save ${key} to localStorage (quota exceeded or disabled):`, error);
  }
};

const checkAndOpenApiKey = async () => {
  if (window.aistudio) {
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      await window.aistudio.openSelectKey();
      return true; // Assume success after opening dialog
    }
    return true;
  }
  return true; // Fallback for environments without aistudio global
};

const useGeminiQuota = () => {
  const [isExhausted, setIsExhausted] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const checkQuota = () => {
      const stored = localStorage.getItem('gemini_quota_reset');
      if (stored) {
        const time = parseInt(stored, 10);
        const now = Date.now();
        if (time > now) {
          setIsExhausted(true);
          const diff = time - now;
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((diff % (1000 * 60)) / 1000);
          setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
        } else {
          setIsExhausted(false);
          localStorage.removeItem('gemini_quota_reset');
          setTimeLeft('');
        }
      } else {
        setIsExhausted(false);
        setTimeLeft('');
      }
    };

    checkQuota();
    const interval = setInterval(checkQuota, 1000);
    return () => clearInterval(interval);
  }, []);

  const setExhausted = () => {
    const time = Date.now() + 24 * 60 * 60 * 1000;
    safeSetLocalStorage('gemini_quota_reset', time.toString());
    setIsExhausted(true);
  };

  return { isExhausted, timeLeft, setExhausted };
};

const CartDrawer = ({ 
  isOpen, 
  onClose, 
  cart, 
  filters,
  onUpdateQuantity, 
  onRemove, 
  onCheckout, 
  t 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  cart: CartItem[], 
  filters?: Filter[],
  onUpdateQuantity: (id: string | number, q: number) => void, 
  onRemove: (id: string | number) => void, 
  onCheckout: () => void,
  t: any 
}) => {
  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
          />
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-brand-nude dark:bg-brand-dark z-[101] shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b dark:border-white/10 flex justify-between items-center bg-brand-nude dark:bg-brand-dark">
              <h2 className="text-2xl font-bold tracking-tighter flex items-center gap-2 dark:text-brand-nude">
                <ShoppingBag size={24} className="text-brand-peach dark:text-brand-nude" /> {t.cart.title}
              </h2>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors text-gray-500 dark:text-brand-nude">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-6">
                  <ShoppingBag size={80} strokeWidth={1} className="opacity-20" />
                  <div className="text-center">
                    <p className="text-xl font-bold text-gray-900 dark:text-brand-nude mb-2">{t.cart.empty}</p>
                    <p className="text-sm dark:text-brand-nude/60">¡Explora nuestro catálogo y encuentra algo para ti!</p>
                  </div>
                  <button 
                    onClick={onClose}
                    className="bg-brand-peach text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-brand-peach/20 hover:scale-105 transition-transform"
                  >
                    {t.checkout.backToCatalog}
                  </button>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.cartItemId || item.id} className="flex gap-4 group">
                    <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gray-100 flex-shrink-0">
                      <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 flex flex-col justify-between py-1">
                      <div>
                        <div className="flex justify-between items-start">
                          <h3 className="font-bold text-sm leading-tight dark:text-brand-nude">{item.name}</h3>
                          <button onClick={() => onRemove(item.cartItemId || item.id!)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors dark:text-brand-nude/60">
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-brand-nude/60 mt-1 space-y-0.5">
                          {item.selectedSize && <p>Talle: {item.selectedSize}</p>}
                          {item.selectedColor && (
                            <div className="flex items-center gap-1">
                              <span>Color:</span>
                              <div className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: item.selectedColor }} />
                            </div>
                          )}
                          {item.selectedDynamicFilters && Object.entries(item.selectedDynamicFilters).map(([key, value]) => {
                            const filterName = filters?.find(f => f.id === key)?.name || key;
                            return <p key={key}>{filterName}: {value}</p>;
                          })}
                        </div>
                        <p className="text-brand-peach font-bold mt-1">${item.price.toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center border dark:border-white/10 rounded-full px-2 py-1 gap-3 dark:bg-white/5">
                          <button 
                            onClick={() => onUpdateQuantity(item.cartItemId || item.id!, item.quantity - 1)}
                            className="w-6 h-6 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors dark:text-brand-nude"
                          >
                            -
                          </button>
                          <span className="text-sm font-bold w-4 text-center dark:text-brand-nude">{item.quantity}</span>
                          <button 
                            onClick={() => onUpdateQuantity(item.cartItemId || item.id!, item.quantity + 1)}
                            className="w-6 h-6 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors dark:text-brand-nude"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-6 border-t dark:border-white/10 bg-brand-nude dark:bg-brand-dark/50 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 dark:text-brand-nude/70 font-medium">{t.cart.total}</span>
                  <span className="text-3xl font-bold text-brand-peach dark:text-brand-nude">${total.toLocaleString()}</span>
                </div>
                <button 
                  onClick={onCheckout}
                  className="w-full bg-brand-peach text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-brand-peach/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {t.cart.checkout} <ArrowRight size={20} />
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const AuthModal = ({ 
  isOpen, 
  onClose, 
  t,
  isPendingAdmin
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  t: any,
  isPendingAdmin: boolean
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requestAdmin, setRequestAdmin] = useState(false);
  
  // Registration fields
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setError(t.auth.error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await loginWithEmail(email, password);
      } else {
        if (!displayName || !email || !password) {
          setError(t.auth.fieldsRequired);
          setLoading(false);
          return;
        }
        await registerWithEmail(email, password, { 
          displayName, 
          phone, 
          city, 
          address,
          role: requestAdmin ? 'admin' : 'user',
          approved: false
        });
      }
      onClose();
    } catch (err: any) {
      setError(err.message || t.auth.error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[var(--bg-primary)] w-full max-w-md rounded-[40px] overflow-hidden relative shadow-2xl border border-[var(--border-color)] p-8 md:p-10"
      >
        <button 
          onClick={onClose} 
          className="absolute top-6 right-6 p-2 text-[var(--text-secondary)] hover:text-brand-peach transition-colors"
        >
          <X size={24} />
        </button>

        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold tracking-tighter uppercase mb-2 text-[var(--text-primary)]">
            {mode === 'login' ? t.auth.loginTitle : t.auth.registerTitle}
          </h2>
          {isPendingAdmin && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 p-4 rounded-2xl text-sm mb-4">
              Tu cuenta de administrador está pendiente de aprobación. Se ha enviado un correo al administrador (dgmvolpi@gmail.com) para confirmar tu acceso.
            </div>
          )}
          <p className="text-[var(--text-secondary)] text-sm">
            {mode === 'login' ? t.auth.noAccount : t.auth.hasAccount}{' '}
            <button 
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="text-brand-peach font-bold hover:underline"
            >
              {mode === 'login' ? t.auth.registerButton : t.auth.loginButton}
            </button>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder={t.profile.name}
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
                required
              />
              <div className="grid grid-cols-2 gap-4">
                <input 
                  type="text" 
                  placeholder={t.profile.phone}
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
                />
                <input 
                  type="text" 
                  placeholder={t.profile.city}
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
                />
              </div>
              <input 
                type="text" 
                placeholder={t.profile.address}
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
              />
              <label className="flex items-center gap-3 p-4 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl cursor-pointer hover:bg-[var(--bg-primary)] transition-colors">
                <input 
                  type="checkbox" 
                  checked={requestAdmin}
                  onChange={e => setRequestAdmin(e.target.checked)}
                  className="w-5 h-5 accent-brand-peach"
                />
                <span className="text-sm font-medium text-[var(--text-primary)]">Solicitar acceso de Administrador</span>
              </label>
            </div>
          )}

          <input 
            type="email" 
            placeholder={t.auth.email}
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
            required
          />
          <input 
            type="password" 
            placeholder={t.auth.password}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
            required
          />

          {error && <p className="text-red-500 text-xs text-center font-medium">{error}</p>}

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-brand-dark text-white py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-brand-peach transition-all disabled:opacity-50"
          >
            {loading ? t.checkout.processing : (mode === 'login' ? t.auth.loginButton : t.auth.registerButton)}
          </button>
        </form>

        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--border-color)]"></div>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-[var(--bg-primary)] px-4 text-[var(--text-secondary)] font-bold">{t.auth.or}</span>
          </div>
        </div>

        <button 
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-[var(--bg-primary)] transition-all disabled:opacity-50"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
          {t.auth.google}
        </button>
      </motion.div>
    </div>
  );
};

const UserProfileModal = ({ 
  isOpen, 
  onClose, 
  user, 
  t,
  initialTab = 'data'
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  user: User | null, 
  t: any,
  initialTab?: 'data' | 'orders'
}) => {
  const [activeTab, setActiveTab] = useState<'data' | 'orders'>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, isOpen]);
  const [profileData, setProfileData] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (isOpen && user) {
      fetchData();
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (isOpen && user && user.email) {
      const q = query(collection(db, 'orders'), where('customer_email', '==', user.email), orderBy('created_at', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const oData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[];
        setOrders(oData);
      }, (error) => {
        console.error("Error fetching user orders:", error);
      });
      return () => unsubscribe();
    }
  }, [isOpen, user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const cachedProfile = localStorage.getItem(`sorella_profile_${user.uid}`);
      if (cachedProfile) {
        setProfileData(JSON.parse(cachedProfile));
      }

      const profile = await getUserProfile(user.uid);
      const newProfileData = {
        displayName: user.displayName || '',
        email: user.email || '',
        phone: '',
        address: '',
        city: '',
        ...profile
      };
      setProfileData(newProfileData);
      try {
        safeSetLocalStorage(`sorella_profile_${user.uid}`, JSON.stringify(newProfileData));
      } catch (e) {
        console.warn("Could not save profile to localStorage:", e);
      }
    } catch (error: any) {
      console.error("Error fetching user data", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await saveUserProfile(user.uid, {
        ...profileData,
        uid: user.uid
      });
      setSuccess(true);
    } catch (error) {
      console.error("Error saving profile", error);
    } finally {
      setSaving(false);
    }
  };

  const [retryingOrderId, setRetryingOrderId] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);

  const handleRetryPayment = async (order: any) => {
    setRetryingOrderId(order.order_number);
    setPaymentLink(null);
    console.log(`[RETRY] Starting payment retry for order: ${order.order_number}`);
    try {
      const response = await fetch(`/api/checkout/retry/${order.order_number}`, {
        headers: { 'Accept': 'application/json' }
      });
      
      const data = await response.json();
      console.log(`[RETRY] Server response:`, data);

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar el pago');
      }

      if (data.init_point) {
        setPaymentLink(data.init_point);
        console.log(`[RETRY] Opening Mercado Pago: ${data.init_point}`);
        // Try to open in new tab first to avoid iframe issues
        try {
          const win = window.open(data.init_point, '_blank');
          if (!win || win.closed || typeof win.closed === 'undefined') {
            console.warn("[RETRY] Pop-up blocked, trying top-level redirect");
            try {
              window.top!.location.href = data.init_point;
            } catch (e) {
              console.warn("[RETRY] Top-level redirect blocked, using iframe redirect");
              window.location.href = data.init_point;
            }
          }
        } catch (e) {
          console.error("[RETRY] window.open failed, using fallback redirect", e);
          window.location.href = data.init_point;
        }
        return;
      } else {
        throw new Error('No se recibió el link de pago de Mercado Pago');
      }
    } catch (err: any) {
      console.error("[RETRY] Error:", err);
      const msg = err instanceof Error ? err.message : (typeof err === 'string' ? err : JSON.stringify(err));
      alert(`Error al procesar el pago: ${msg || "Por favor intenta nuevamente."}`);
    } finally {
      setRetryingOrderId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[var(--bg-primary)] w-full max-w-2xl rounded-[40px] overflow-hidden relative max-h-[90vh] flex flex-col shadow-2xl border border-[var(--border-color)]"
      >
        <button 
          onClick={onClose} 
          className="absolute top-6 right-6 p-3 bg-brand-peach text-brand-dark hover:bg-brand-dark hover:text-white rounded-full z-[160] shadow-xl transition-all"
        >
          <X size={24} />
        </button>

        <div className="flex border-b border-[var(--border-color)]">
          <button 
            onClick={() => setActiveTab('data')}
            className={`flex-1 py-6 font-bold uppercase tracking-widest text-xs transition-all ${activeTab === 'data' ? 'text-brand-peach border-b-2 border-brand-peach' : 'text-[var(--text-secondary)]'}`}
          >
            {t.profile.title}
          </button>
          <button 
            onClick={() => setActiveTab('orders')}
            className={`flex-1 py-6 font-bold uppercase tracking-widest text-xs transition-all ${activeTab === 'orders' ? 'text-brand-peach border-b-2 border-brand-peach' : 'text-[var(--text-secondary)]'}`}
          >
            {t.profile.ordersTitle}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 md:p-12">
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="w-12 h-12 border-4 border-brand-peach/20 border-t-brand-peach rounded-full animate-spin" />
            </div>
          ) : activeTab === 'data' ? (
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{t.profile.name}</label>
                  <input 
                    type="text" 
                    value={profileData?.displayName || ''} 
                    onChange={e => setProfileData({...profileData, displayName: e.target.value})}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{t.profile.email}</label>
                  <input 
                    type="email" 
                    value={profileData?.email || ''} 
                    disabled
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none opacity-60 text-[var(--text-primary)]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{t.profile.phone}</label>
                  <input 
                    type="text" 
                    value={profileData?.phone || ''} 
                    onChange={e => setProfileData({...profileData, phone: e.target.value})}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{t.profile.city}</label>
                  <input 
                    type="text" 
                    value={profileData?.city || ''} 
                    onChange={e => setProfileData({...profileData, city: e.target.value})}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{t.profile.address}</label>
                <input 
                  type="text" 
                  value={profileData?.address || ''} 
                  onChange={e => setProfileData({...profileData, address: e.target.value})}
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
                />
              </div>
              <div className="flex flex-col gap-4">
                {success && (
                  <div className="bg-green-500/10 border border-green-500/20 text-green-500 p-4 rounded-2xl text-sm font-bold flex items-center gap-2">
                    <Check size={18} /> {t.profile.saved}
                  </div>
                )}
                <button 
                  type="submit"
                  disabled={saving}
                  className="w-full bg-brand-peach text-brand-dark py-4 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-xl shadow-brand-peach/20 disabled:opacity-50"
                >
                  {saving ? t.checkout.processing : t.profile.save}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-6">
              {orders.length === 0 ? (
                <div className="text-center py-12 text-[var(--text-secondary)]">
                  <Package size={48} className="mx-auto mb-4 opacity-20" />
                  <p>{t.profile.noOrders}</p>
                </div>
              ) : (
                orders.map(order => (
                  <div key={order.id} className="bg-[var(--bg-secondary)] p-6 rounded-3xl border border-[var(--border-color)] space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-brand-peach">{t.profile.orderNumber}{order.order_number || order.id.slice(0,8)}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{order.created_at ? new Date(order.created_at).toLocaleDateString() : 'N/A'}</p>
                      </div>
                      <span className="px-3 py-1 bg-brand-peach/10 text-brand-peach rounded-full text-xs font-bold uppercase">
                        {order.status}
                      </span>
                    </div>
                    <div className="space-y-4">
                      {order.items?.map((item: any, idx: number) => (
                        <div key={idx} className="flex flex-col text-sm text-[var(--text-primary)] border-b border-[var(--border-color)] pb-2 last:border-0 last:pb-0">
                          <div className="flex justify-between">
                            <span className="font-bold">{item.name} x{item.quantity}</span>
                            <span className="font-bold">${(item.price * item.quantity).toLocaleString()}</span>
                          </div>
                          <div className="text-xs text-[var(--text-secondary)] mt-1 space-y-0.5">
                            {item.selectedSize && <p>Talle: {item.selectedSize}</p>}
                            {item.selectedColor && (
                              <div className="flex items-center gap-1">
                                <span>Color:</span>
                                <div className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: item.selectedColor }} />
                              </div>
                            )}
                            {item.selectedDynamicFilters && Object.entries(item.selectedDynamicFilters).map(([key, value]) => (
                              <p key={key}>{key}: {String(value)}</p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pt-4 border-t border-[var(--border-color)] flex justify-between items-center">
                      <span className="font-bold text-[var(--text-primary)]">{t.profile.total}</span>
                      <div className="flex items-center gap-4">
                        {order.status === 'Pendiente de pago' && (
                          <div className="flex flex-col items-end gap-2">
                            <button 
                              onClick={() => handleRetryPayment(order)}
                              disabled={retryingOrderId === order.order_number}
                              className="px-4 py-2 bg-brand-peach text-brand-dark rounded-xl font-bold text-sm hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100"
                            >
                              {retryingOrderId === order.order_number ? t.checkout.processing : t.profile.pay}
                            </button>
                            {paymentLink && retryingOrderId === order.order_number && (
                              <a 
                                href={paymentLink} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[10px] text-brand-peach underline"
                              >
                                ¿No fuiste redirigido? Haz clic aquí
                              </a>
                            )}
                          </div>
                        )}
                        <span className="text-xl font-bold text-brand-peach">${order.total?.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const CustomCursor = () => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'BUTTON' || 
        target.tagName === 'A' || 
        target.closest('button') || 
        target.closest('a') ||
        target.classList.contains('cursor-pointer')
      ) {
        setIsHovering(true);
      } else {
        setIsHovering(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseover', handleMouseOver);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseover', handleMouseOver);
    };
  }, []);

  return (
    <motion.div
      className="fixed top-0 left-0 w-[60px] h-[60px] rounded-full border border-brand-peach/30 pointer-events-none z-[9999] flex items-center justify-center hidden md:flex"
      animate={{
        x: position.x - 30,
        y: position.y - 30,
        scale: isHovering ? 1.5 : 1,
        backgroundColor: isHovering ? 'rgba(232, 194, 176, 0.4)' : 'rgba(232, 194, 176, 0.1)',
        boxShadow: isHovering ? '0 0 30px rgba(232, 194, 176, 0.6)' : '0 0 15px rgba(232, 194, 176, 0.3)'
      }}
      transition={{ type: 'spring', damping: 20, stiffness: 400, mass: 0.3 }}
    >
      <div className="w-2 h-2 bg-brand-peach rounded-full shadow-[0_0_8px_rgba(232, 194, 176, 1)]" />
    </motion.div>
  );
};

// Components
const AnnouncementBar = ({ settings }: { settings: Settings | null }) => {
  if (!settings || settings.announcement_enabled !== '1') return null;
  return (
    <div 
      className="w-full py-2 px-6 text-center text-xs font-bold uppercase tracking-[0.2em] overflow-hidden relative z-[60]"
      style={{ backgroundColor: settings.announcement_bg, color: settings.announcement_text_color }}
    >
      <motion.div
        animate={{ x: [0, -20, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      >
        {settings.announcement_text}
      </motion.div>
    </div>
  );
};

const Navbar = ({ 
  language, 
  setLanguage, 
  theme, 
  setTheme, 
  t, 
  user, 
  cartCount, 
  onCartClick, 
  onCategoryFilter,
  onSizeFilter,
  onColorFilter,
  onProfileClick,
  settings,
  setIsAuthOpen,
  isAdmin,
  products
}: { 
  language: Language, 
  setLanguage: (l: Language) => void, 
  theme: string, 
  setTheme: (t: any) => void, 
  t: any, 
  user: User | null, 
  cartCount: number, 
  onCartClick: () => void, 
  onCategoryFilter: (cat: string) => void,
  onSizeFilter: (size: string) => void,
  onColorFilter: (color: string) => void,
  onProfileClick: (tab?: 'data' | 'orders') => void,
  settings: Settings | null,
  setIsAuthOpen: (open: boolean) => void,
  isAdmin: boolean,
  products: Product[]
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminPage = location.pathname === '/admin';
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return products.filter(p => 
      p.name.toLowerCase().includes(query) || 
      (p.description && p.description.toLowerCase().includes(query))
    ).slice(0, 5);
  }, [searchQuery, products]);

  // Close search when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.search-container') && !(e.target as Element).closest('.mobile-search-toggle')) {
        setIsSearchOpen(false);
        setIsMobileSearchOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleNavClick = (link: string, type: 'category' | 'custom') => {
    setIsMobileMenuOpen(false);
    if (type === 'category') {
      onCategoryFilter(link);
      if (link === 'Indumentaria') navigate('/indumentaria');
      else if (link === 'Perfumes') navigate('/perfumes');
      else {
        navigate('/catalogo');
      }
    } else {
      if (link.startsWith('http')) {
        window.open(link, '_blank');
      } else {
        navigate(link);
        if (link === '/' || link === '/catalog' || link === '/catalogo') {
          onCategoryFilter('Todos');
          onSizeFilter('Todos');
          onColorFilter('Todos');
        }
      }
    }
  };

  const menuItems: MenuItem[] = useMemo(() => {
    try {
      return settings?.menu_items ? JSON.parse(settings.menu_items) : [];
    } catch {
      return [];
    }
  }, [settings?.menu_items]);

  const Logo = () => {
    const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const logoUrl = (isDark && settings?.logo_url_dark) ? settings.logo_url_dark : settings?.logo_url;
    
    return (
      <Link to="/" className="flex items-center gap-2" onClick={() => onCategoryFilter('Todos')}>
        {settings?.logo_enabled === '1' && logoUrl ? (
          <img src={logoUrl} alt="Logo" className="h-10 w-auto object-contain" />
        ) : (
          <div className="w-10 h-10 bg-brand-peach rounded-full flex items-center justify-center font-bold text-white shrink-0">
            {settings?.logo_text ? settings.logo_text.charAt(0).toUpperCase() : 'S'}
          </div>
        )}
        {settings?.logo_text && (
          <span className="text-xl font-semibold tracking-tighter uppercase hidden sm:block">
            {settings.logo_text}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav className="w-full glass-morphism px-4 md:px-6 py-4 flex justify-between items-center relative z-[100]">
      {/* Desktop/Tablet Layout */}
      <div className="hidden lg:flex items-center gap-8 flex-1">
        <Logo />
        {!isAdminPage && (
          <div className="flex items-center gap-6">
            {menuItems.map((item) => (
              <button 
                key={item.id}
                onClick={() => handleNavClick(item.link, item.type)}
                className="hover:text-brand-peach transition-colors text-xs uppercase tracking-widest font-bold"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Center/Right Controls (Desktop) */}
      <div className="hidden lg:flex items-center gap-4">
        {!isAdminPage && (
          <div className="relative search-container">
            <div className={`flex items-center bg-[var(--bg-secondary)] rounded-full border transition-all ${isSearchOpen ? 'border-brand-peach w-64' : 'border-[var(--border-color)] w-48'}`}>
              <Search size={16} className="ml-3 text-[var(--text-secondary)]" />
              <input 
                type="text"
                placeholder={language === 'es' ? 'Buscar...' : 'Search...'}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchOpen(true);
                }}
                onFocus={() => setIsSearchOpen(true)}
                className="w-full bg-transparent border-none outline-none py-2 px-3 text-sm text-[var(--text-primary)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  <X size={14} />
                </button>
              )}
            </div>
            
            <AnimatePresence>
              {isSearchOpen && searchQuery.trim() && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute top-full mt-2 w-full bg-[var(--bg-primary)] rounded-2xl shadow-xl border border-[var(--border-color)] overflow-hidden z-50"
                >
                  {searchResults.length > 0 ? (
                    <div className="py-2">
                      {searchResults.map(product => (
                        <button
                          key={product.id}
                          onClick={() => {
                            navigate(`/product/${product.id}`);
                            setIsSearchOpen(false);
                            setSearchQuery('');
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[var(--bg-secondary)] transition-colors text-left"
                        >
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} className="w-10 h-10 rounded-lg object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-brand-peach/20 flex items-center justify-center text-brand-peach">
                              <ShoppingBag size={16} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-[var(--text-primary)] truncate">{product.name}</p>
                            <p className="text-xs text-[var(--text-secondary)]">${product.price}</p>
                          </div>
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          navigate(`/catalogo?search=${searchQuery}`);
                          setIsSearchOpen(false);
                          setSearchQuery('');
                        }}
                        className="w-full p-3 text-center text-xs font-bold uppercase tracking-widest text-brand-peach hover:bg-brand-peach/5 transition-colors border-t border-[var(--border-color)]"
                      >
                        {t.search.viewAll}
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-[var(--text-secondary)]">
                      {language === 'es' ? 'No se encontraron resultados' : 'No results found'}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <button 
          onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
          className="p-2 hover:bg-brand-peach/20 rounded-full transition-colors flex items-center gap-1 text-xs font-bold"
        >
          <Globe size={18} />
          <span className="uppercase">{language}</span>
        </button>

        <div className="flex bg-[var(--bg-secondary)] p-1 rounded-full gap-1">
          {['light', 'auto', 'dark'].map((m) => (
            <button 
              key={m}
              onClick={() => setTheme(m as any)}
              className={`p-1.5 rounded-full transition-all ${theme === m ? (m === 'dark' ? 'bg-brand-dark text-white' : m === 'auto' ? 'bg-brand-peach text-white' : 'bg-white text-brand-dark') : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              {m === 'light' && <Sun size={14} />}
              {m === 'auto' && <Clock size={14} />}
              {m === 'dark' && <Moon size={14} />}
            </button>
          ))}
        </div>

        {user ? (
          <div className="relative">
            <button 
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center gap-2 p-1 pr-3 hover:bg-brand-peach/10 rounded-full transition-all border border-transparent hover:border-brand-peach/20"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-brand-peach" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-brand-peach flex items-center justify-center text-white font-bold text-xs">
                  {user.displayName?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
                </div>
              )}
              <ChevronDown size={14} className={`transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {isUserMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-56 bg-[var(--bg-primary)] rounded-3xl shadow-2xl border border-[var(--border-color)] p-2 z-50 overflow-hidden"
                  >
                    <div className="p-4 border-b border-[var(--border-color)] mb-2">
                      <p className="text-xs font-bold uppercase tracking-widest text-brand-peach mb-1">{t.auth.welcome}</p>
                      <p className="font-bold truncate text-[var(--text-primary)]">{user.displayName}</p>
                    </div>
                    <button 
                      onClick={() => { onProfileClick('data'); setIsUserMenuOpen(false); }}
                      className="w-full flex items-center gap-3 p-3 hover:bg-brand-peach/10 rounded-2xl transition-colors text-sm font-medium text-[var(--text-primary)]"
                    >
                      <UserCircle size={18} className="text-brand-peach" />
                      {t.userMenu.profile}
                    </button>
                    <button 
                      onClick={() => { onProfileClick('orders'); setIsUserMenuOpen(false); }}
                      className="w-full flex items-center gap-3 p-3 hover:bg-brand-peach/10 rounded-2xl transition-colors text-sm font-medium text-[var(--text-primary)]"
                    >
                      <Package size={18} className="text-brand-peach" />
                      {t.userMenu.orders}
                    </button>
                    <button 
                      onClick={() => { navigate('/wishlist'); setIsUserMenuOpen(false); }}
                      className="w-full flex items-center gap-3 p-3 hover:bg-brand-peach/10 rounded-2xl transition-colors text-sm font-medium text-[var(--text-primary)]"
                    >
                      <Heart size={18} className="text-brand-peach" />
                      {t.userMenu.wishlist}
                    </button>
                    {isAdmin && (
                      <Link to="/admin" onClick={() => setIsUserMenuOpen(false)} className="w-full flex items-center gap-3 p-3 hover:bg-brand-peach/10 rounded-2xl transition-colors text-sm font-medium text-[var(--text-primary)]">
                        <SettingsIcon size={18} className="text-brand-peach" />
                        {t.userMenu.admin}
                      </Link>
                    )}
                    <div className="h-px border-t border-[var(--border-color)] my-2" />
                    <button onClick={() => { logout(); setIsUserMenuOpen(false); }} className="w-full flex items-center gap-3 p-3 hover:bg-red-500/10 text-red-500 rounded-2xl transition-colors text-sm font-medium">
                      <LogOut size={18} />
                      {t.userMenu.logout}
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <button onClick={() => setIsAuthOpen(true)} className="bg-brand-peach text-white px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest hover:scale-105 transition-transform">
            {t.auth.login}
          </button>
        )}

        <button onClick={onCartClick} className="relative p-2 hover:bg-brand-peach/20 rounded-full transition-colors">
          <ShoppingBag size={24} />
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-brand-peach text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white dark:border-brand-dark">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {/* Mobile Layout */}
      <div className="lg:hidden flex items-center justify-between w-full relative">
        {!isMobileSearchOpen ? (
          <>
            <Logo />
            
            <div className="flex items-center gap-1 sm:gap-2">
              <button 
                onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
                className="p-1.5 sm:p-2 hover:bg-brand-peach/20 rounded-full transition-colors text-xs font-bold"
              >
                <span className="uppercase">{language}</span>
              </button>

              <div className="flex bg-brand-nude/30 dark:bg-white/10 p-1 rounded-full gap-0.5">
                {['light', 'auto', 'dark'].map((m) => (
                  <button 
                    key={m}
                    onClick={() => setTheme(m as any)}
                    className={`p-1 rounded-full transition-all ${theme === m ? (m === 'dark' ? 'bg-brand-dark text-white' : m === 'auto' ? 'bg-brand-peach text-white' : 'bg-white text-brand-dark') : 'text-gray-400'}`}
                  >
                    {m === 'light' && <Sun size={12} />}
                    {m === 'auto' && <Clock size={12} />}
                    {m === 'dark' && <Moon size={12} />}
                  </button>
                ))}
              </div>

              {user ? (
                <button onClick={() => onProfileClick()} className="p-1">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName || ''} className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-brand-peach" />
                  ) : (
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-brand-peach flex items-center justify-center text-white font-bold text-xs">
                      {user.displayName?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
                    </div>
                  )}
                </button>
              ) : (
                <button onClick={() => setIsAuthOpen(true)} className="p-1.5 sm:p-2 text-brand-peach">
                  <LogIn size={18} className="sm:w-5 sm:h-5" />
                </button>
              )}

              <button onClick={() => setIsMobileSearchOpen(true)} className="mobile-search-toggle p-1.5 sm:p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <Search size={20} className="sm:w-[22px] sm:h-[22px]" />
              </button>

              <button onClick={onCartClick} className="relative p-1.5 sm:p-2">
                <ShoppingBag size={20} className="sm:w-[22px] sm:h-[22px]" />
                {cartCount > 0 && (
                  <span className="absolute top-0 right-0 bg-brand-peach text-white text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </button>

              <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-1.5 sm:p-2" style={{ color: settings?.announcement_bg || 'currentColor' }}>
                <Menu size={22} className="sm:w-6 sm:h-6" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center w-full gap-2 search-container animate-in fade-in slide-in-from-right-4 duration-200">
            <div className="flex-1 flex items-center bg-[var(--bg-secondary)] rounded-full border border-brand-peach px-3 py-1.5">
              <Search size={16} className="text-[var(--text-secondary)]" />
              <input 
                type="text"
                autoFocus
                placeholder={language === 'es' ? 'Buscar...' : 'Search...'}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchOpen(true);
                }}
                onFocus={() => setIsSearchOpen(true)}
                className="w-full bg-transparent border-none outline-none py-1 px-2 text-sm text-[var(--text-primary)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  <X size={14} />
                </button>
              )}
            </div>
            <button onClick={() => { setIsMobileSearchOpen(false); setSearchQuery(''); setIsSearchOpen(false); }} className="p-2 text-[var(--text-secondary)]">
              <X size={22} />
            </button>
            
            <AnimatePresence>
              {isSearchOpen && searchQuery.trim() && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute top-full left-0 right-0 mt-2 bg-[var(--bg-primary)] rounded-2xl shadow-xl border border-[var(--border-color)] overflow-hidden z-50"
                >
                  {searchResults.length > 0 ? (
                    <div className="py-2 max-h-60 overflow-y-auto">
                      {searchResults.map(product => (
                        <button
                          key={product.id}
                          onClick={() => {
                            navigate(`/product/${product.id}`);
                            setIsSearchOpen(false);
                            setIsMobileSearchOpen(false);
                            setSearchQuery('');
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[var(--bg-secondary)] transition-colors text-left"
                        >
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} className="w-10 h-10 rounded-lg object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-brand-peach/20 flex items-center justify-center text-brand-peach">
                              <ShoppingBag size={16} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-[var(--text-primary)] truncate">{product.name}</p>
                            <p className="text-xs text-[var(--text-secondary)]">${product.price}</p>
                          </div>
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          navigate(`/catalogo?search=${searchQuery}`);
                          setIsSearchOpen(false);
                          setIsMobileSearchOpen(false);
                          setSearchQuery('');
                        }}
                        className="w-full p-3 text-center text-xs font-bold uppercase tracking-widest text-brand-peach hover:bg-brand-peach/5 transition-colors border-t border-[var(--border-color)]"
                      >
                        {t.search.viewAll}
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-[var(--text-secondary)]">
                      {language === 'es' ? 'No se encontraron resultados' : 'No results found'}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Mobile Menu Drawer */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ y: '-100%' }}
              animate={{ y: 0 }}
              exit={{ y: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 200 }}
              className="fixed left-0 right-0 top-0 h-auto max-h-[90vh] bg-[#2D241E] text-white z-[101] shadow-2xl flex flex-col rounded-b-[40px] overflow-hidden"
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-center">
                <h2 className="text-2xl font-bold tracking-tighter flex items-center gap-2 text-white/90">
                  <Menu size={24} className="text-white/60" /> {t.nav.menu}
                </h2>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60">
                  <X size={24} />
                </button>
              </div>

              <div className="px-6 pt-6 pb-2">
                <div className="relative search-container">
                  <div className="flex items-center bg-white/5 rounded-2xl border border-white/10 p-2 focus-within:border-brand-peach transition-colors">
                    <Search size={18} className="text-white/40 ml-2" />
                    <input 
                      type="text"
                      placeholder={language === 'es' ? 'Buscar productos...' : 'Search products...'}
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setIsSearchOpen(true);
                      }}
                      onFocus={() => setIsSearchOpen(true)}
                      className="w-full bg-transparent border-none outline-none py-2 px-3 text-sm text-white placeholder-white/40"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="p-2 text-white/40 hover:text-white">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  
                  <AnimatePresence>
                    {isSearchOpen && searchQuery.trim() && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute top-full mt-2 w-full bg-[#3D342E] rounded-2xl shadow-2xl border border-white/10 overflow-hidden z-50 max-h-[40vh] overflow-y-auto"
                      >
                        {searchResults.length > 0 ? (
                          <div className="py-2">
                            {searchResults.map(product => (
                              <button
                                key={product.id}
                                onClick={() => {
                                  navigate(`/product/${product.id}`);
                                  setIsSearchOpen(false);
                                  setIsMobileMenuOpen(false);
                                  setSearchQuery('');
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-0"
                              >
                                {product.image_url ? (
                                  <img src={product.image_url} alt={product.name} className="w-12 h-12 rounded-xl object-cover" />
                                ) : (
                                  <div className="w-12 h-12 rounded-xl bg-brand-peach/20 flex items-center justify-center text-brand-peach">
                                    <ShoppingBag size={18} />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-white truncate">{product.name}</p>
                                  <p className="text-xs text-white/60">${product.price}</p>
                                </div>
                              </button>
                            ))}
                            <button
                              onClick={() => {
                                navigate(`/catalogo?search=${searchQuery}`);
                                setIsSearchOpen(false);
                                setIsMobileMenuOpen(false);
                                setSearchQuery('');
                              }}
                              className="w-full p-4 text-center text-xs font-bold uppercase tracking-widest text-brand-peach hover:bg-white/5 transition-colors border-t border-white/5"
                            >
                              {t.search.viewAll}
                            </button>
                          </div>
                        ) : (
                          <div className="p-6 text-center text-sm text-white/60">
                            {language === 'es' ? 'No se encontraron resultados' : 'No results found'}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  {menuItems.map((item) => {
                    const isUrl = item.icon && (item.icon.startsWith('data:') || item.icon.startsWith('http'));
                    const IconComponent = (!isUrl && item.icon) ? ((Icons as any)[item.icon] || LayoutGrid) : LayoutGrid;
                    return (
                      <button 
                        key={item.id}
                        onClick={() => handleNavClick(item.link, item.type)}
                        className="group flex items-center gap-4 p-3 rounded-2xl bg-white/5 hover:bg-brand-peach/10 transition-all border border-white/5"
                      >
                        <div className="w-8 h-8 rounded-xl bg-brand-peach/10 flex items-center justify-center text-brand-peach group-hover:bg-brand-peach group-hover:text-white transition-all overflow-hidden">
                          {isUrl ? (
                            <img src={item.icon} className="w-full h-full object-contain p-1" />
                          ) : (
                            <IconComponent size={16} />
                          )}
                        </div>
                        <span className="text-sm font-bold tracking-tighter uppercase text-white group-hover:text-brand-peach transition-colors flex-1 text-left">
                          {item.label}
                        </span>
                        <ArrowRight size={14} className="text-white/20 group-hover:text-brand-peach transition-all" />
                      </button>
                    );
                  })}

                  {user && (
                    <div className="pt-4 border-t border-white/10 space-y-3">
                      <button 
                        onClick={() => { onProfileClick(); setIsMobileMenuOpen(false); }}
                        className="w-full flex items-center gap-4 p-3 rounded-2xl bg-white/5 hover:bg-brand-peach/10 transition-all border border-white/5"
                      >
                        <div className="w-8 h-8 rounded-xl bg-brand-peach/10 flex items-center justify-center text-brand-peach">
                          <UserCircle size={16} />
                        </div>
                        <span className="text-sm font-bold tracking-tighter uppercase text-white">{t.userMenu.profile}</span>
                      </button>
                      <button 
                        onClick={() => { navigate('/wishlist'); setIsMobileMenuOpen(false); }}
                        className="w-full flex items-center gap-4 p-3 rounded-2xl bg-white/5 hover:bg-brand-peach/10 transition-all border border-white/5"
                      >
                        <div className="w-8 h-8 rounded-xl bg-brand-peach/10 flex items-center justify-center text-brand-peach">
                          <Heart size={16} />
                        </div>
                        <span className="text-sm font-bold tracking-tighter uppercase text-white">{t.userMenu.wishlist}</span>
                      </button>
                      {isAdmin && (
                        <button 
                          onClick={() => { navigate('/admin'); setIsMobileMenuOpen(false); }}
                          className="w-full flex items-center gap-4 p-3 rounded-2xl bg-white/5 hover:bg-brand-peach/10 transition-all border border-white/5"
                        >
                          <div className="w-8 h-8 rounded-xl bg-brand-peach/10 flex items-center justify-center text-brand-peach">
                            <SettingsIcon size={16} />
                          </div>
                          <span className="text-sm font-bold tracking-tighter uppercase text-white">{t.userMenu.admin}</span>
                        </button>
                      )}
                      <button 
                        onClick={() => { logout(); setIsMobileMenuOpen(false); }}
                        className="w-full flex items-center gap-4 p-3 rounded-2xl bg-red-500/10 hover:bg-red-500/20 transition-all border border-red-500/10"
                      >
                        <div className="w-8 h-8 rounded-xl bg-red-500/20 flex items-center justify-center text-red-500">
                          <LogOut size={16} />
                        </div>
                        <span className="text-sm font-bold tracking-tighter uppercase text-red-500">{t.userMenu.logout}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-8 border-t border-white/10 bg-black/20 space-y-8">
                <div className="flex flex-col sm:flex-row justify-between items-center gap-6">
                  <div className="space-y-4 w-full sm:w-auto">
                    <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-brand-peach/60">{t.nav.contact}</p>
                    <a 
                      href={`https://wa.me/${settings?.whatsapp_number}`} 
                      className="flex items-center justify-center gap-3 p-4 bg-brand-peach text-white rounded-full hover:scale-[1.02] active:scale-[0.98] transition-all group shadow-lg shadow-brand-peach/20 font-bold"
                    >
                      <Phone size={20} />
                      <span>WhatsApp Atención Personalizada</span>
                    </a>
                  </div>

                  <div className="flex flex-col items-center sm:items-end gap-4">
                    <div className="flex gap-4">
                      <a href="#" className="w-11 h-11 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:bg-brand-peach hover:text-white transition-all">
                        <Instagram size={20} />
                      </a>
                      <a href="#" className="w-11 h-11 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:bg-brand-peach hover:text-white transition-all">
                        <Facebook size={20} />
                      </a>
                    </div>
                    <div className="text-[10px] text-white/20 font-medium tracking-widest uppercase">
                      © 2026 Sorella
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </nav>
  );
};

const SalesManagement = ({ orders, t, onUpdateStatus, onDeleteOrder, onDeleteOrders }: { orders: Order[], t: any, onUpdateStatus: (id: string | number, status: string) => Promise<void>, onDeleteOrder: (id: string) => Promise<void>, onDeleteOrders: (ids: string[]) => Promise<void> }) => {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(orders.map(o => String(o.id)));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleDeleteSelected = async () => {
    console.log("handleDeleteSelected triggered for IDs:", selectedIds);
    if (window.confirm(`¿Estás seguro de que deseas eliminar ${selectedIds.length} pedidos?`)) {
      setIsDeleting(true);
      try {
        console.log("Calling onDeleteOrders...");
        await onDeleteOrders(selectedIds);
        console.log("onDeleteOrders completed successfully");
        setSelectedIds([]);
      } catch (err) {
        console.error("Bulk delete error in component:", err);
        alert("Error al eliminar los pedidos seleccionados.");
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const handleDelete = async (id: string | number) => {
    console.log("handleDelete triggered for ID:", id);
    if (window.confirm('¿Estás seguro de que deseas eliminar este pedido?')) {
      setIsDeleting(true);
      try {
        console.log("Calling onDeleteOrder...");
        await onDeleteOrder(String(id));
        console.log("onDeleteOrder completed successfully");
        setSelectedIds(prev => prev.filter(i => i !== String(id)));
      } catch (err) {
        console.error("Delete error in component:", err);
        alert("Error al eliminar el pedido.");
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const handlePrint = (type: 'order' | 'delivery') => {
    if (!selectedOrder) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const content = type === 'order' ? `
      <html>
        <head><title>${t.sales.order} #${selectedOrder.order_number}</title></head>
        <body style="font-family: sans-serif; padding: 40px;">
          <h1>Sorella Indumentaria</h1>
          <h2>${t.sales.order} #${selectedOrder.order_number}</h2>
          <hr/>
          <p><strong>${t.sales.customer}:</strong> ${selectedOrder.customer_name}</p>
          <p><strong>${t.sales.email}:</strong> ${selectedOrder.customer_email}</p>
          <p><strong>${t.sales.phone}:</strong> ${selectedOrder.customer_phone}</p>
          <p><strong>${t.sales.date}:</strong> ${selectedOrder.created_at ? new Date(selectedOrder.created_at).toLocaleString() : 'N/A'}</p>
          <hr/>
          <h3>${t.sales.products}:</h3>
          <ul>
            ${selectedOrder.items.map(item => {
              let options = [];
              if (item.selectedSize) options.push(`${t.product?.size || 'Talle'}: ${item.selectedSize}`);
              if (item.selectedColor) options.push(`${t.product?.color || 'Color'}: ${item.selectedColor}`);
              if (item.selectedDynamicFilters) {
                Object.entries(item.selectedDynamicFilters).forEach(([key, value]) => options.push(`${key}: ${value}`));
              }
              const optionsStr = options.length > 0 ? ` (${options.join(', ')})` : '';
              return `<li>${item.name}${optionsStr} x ${item.quantity} - $${item.price * item.quantity}</li>`;
            }).join('')}
          </ul>
          <h3>${t.sales.total}: $${selectedOrder.total}</h3>
          <hr/>
          <p><strong>${t.sales.shippingMethod}:</strong> ${selectedOrder.shipping_method}</p>
          <p><strong>${t.sales.shippingAddress}:</strong> ${selectedOrder.shipping_address}</p>
        </body>
      </html>
    ` : `
      <html>
        <head><title>${t.sales.deliveryNote} #${selectedOrder.order_number}</title></head>
        <body style="font-family: sans-serif; padding: 40px;">
          <div style="border: 2px solid black; padding: 40px;">
            <h1>Sorella Indumentaria - ${t.sales.deliveryNote.toUpperCase()}</h1>
            <p>${t.sales.order} #${selectedOrder.order_number}</p>
            <hr/>
            <p><strong>${t.sales.recipient}:</strong> ${selectedOrder.customer_name}</p>
            <p><strong>${t.sales.shippingAddress}:</strong> ${selectedOrder.shipping_address}</p>
            <p><strong>${t.sales.phone}:</strong> ${selectedOrder.customer_phone}</p>
            <hr/>
            <div style="height: 200px; border: 1px dashed gray; margin-top: 40px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 10px;">
              ${t.sales.customerSignature}
            </div>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.print();
  };

  const handleDownloadExcel = () => {
    const ordersToExport = selectedIds.length > 0 
      ? orders.filter(o => selectedIds.includes(String(o.id)))
      : orders;

    const data = ordersToExport.map(o => ({
      'Nro Pedido': o.order_number,
      'Fecha': o.created_at ? new Date(o.created_at).toLocaleString() : 'N/A',
      'Cliente': o.customer_name,
      'Email': o.customer_email,
      'Teléfono': o.customer_phone,
      'Método Envío': o.shipping_method,
      'Dirección': o.shipping_address,
      'DNI Receptor': o.receiver_dni || '',
      'Nombre Receptor': o.receiver_first_name || '',
      'Apellido Receptor': o.receiver_last_name || '',
      'Total': o.total,
      'Estado': o.status,
      'Productos': o.items.map(i => {
        let options = [];
        if (i.selectedSize) options.push(`Talle: ${i.selectedSize}`);
        if (i.selectedColor) options.push(`Color: ${i.selectedColor}`);
        if (i.selectedDynamicFilters) {
          Object.entries(i.selectedDynamicFilters).forEach(([key, value]) => options.push(`${key}: ${value}`));
        }
        const optionsStr = options.length > 0 ? ` (${options.join(', ')})` : '';
        return `${i.name}${optionsStr} (x${i.quantity})`;
      }).join(', ')
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ventas");
    XLSX.writeFile(workbook, `Ventas_Sorella_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h3 className="text-xl font-bold text-[var(--text-primary)]">{t.admin.sales.title}</h3>
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={handleDownloadExcel}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-full font-bold hover:bg-green-700 transition-colors text-sm shadow-lg shadow-green-600/20"
          >
            <Download size={16} />
            Exportar Excel {selectedIds.length > 0 ? `(${selectedIds.length})` : '(Todos)'}
          </button>
          {selectedIds.length > 0 && (
            <button 
              onClick={handleDeleteSelected}
              disabled={isDeleting}
              className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-full font-bold hover:bg-red-600 transition-colors text-sm disabled:opacity-50 shadow-lg shadow-red-500/20"
            >
              <Trash2 size={16} />
              {isDeleting ? 'Eliminando...' : `Eliminar (${selectedIds.length})`}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-xs font-bold uppercase text-[var(--text-secondary)]">
              <th className="py-4 px-4">
                <input 
                  type="checkbox" 
                  onChange={handleSelectAll}
                  checked={orders.length > 0 && selectedIds.length === orders.length}
                  className="w-4 h-4 rounded border-[var(--border-color)] accent-brand-peach"
                />
              </th>
              <th className="py-4 px-4">{t.admin.sales.orderNumber}</th>
              <th className="py-4 px-4">{t.admin.sales.customer}</th>
              <th className="py-4 px-4">{t.admin.sales.total}</th>
              <th className="py-4 px-4">{t.admin.sales.status}</th>
              <th className="py-4 px-4">{t.admin.sales.date}</th>
              <th className="py-4 px-4">{t.admin.sales.actions}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr key={order.id} className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors ${selectedIds.includes(String(order.id)) ? 'bg-brand-peach/5' : ''}`}>
                <td className="py-4 px-4">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.includes(String(order.id))}
                    onChange={() => handleSelectOne(String(order.id))}
                    className="w-4 h-4 rounded border-[var(--border-color)] accent-brand-peach"
                  />
                </td>
                <td className="py-4 px-4 font-bold text-[var(--text-primary)]">{order.order_number}</td>
                <td className="py-4 px-4">
                  <p className="font-medium text-[var(--text-primary)]">{order.customer_name}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{order.customer_email}</p>
                </td>
                <td className="py-4 px-4 font-bold text-[var(--text-primary)]">${order.total}</td>
                <td className="py-4 px-4">
                  <select 
                    value={order.status}
                    onChange={(e) => onUpdateStatus(order.id!, e.target.value)}
                    className="bg-[var(--bg-secondary)] px-3 py-1 rounded-full text-xs font-bold outline-none border border-[var(--border-color)] text-[var(--text-primary)]"
                  >
                    <option value="En proceso" className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{t.admin.sales.statuses.processing}</option>
                    <option value="Pagado" className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{t.admin.sales.statuses.paid}</option>
                    <option value="En camino" className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{t.admin.sales.statuses.shipping}</option>
                    <option value="Finalizado" className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{t.admin.sales.statuses.completed}</option>
                    <option value="Cancelado" className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{t.admin.sales.statuses.cancelled}</option>
                  </select>
                </td>
                <td className="py-4 px-4 text-xs text-[var(--text-secondary)]">
                  {order.created_at ? new Date(order.created_at).toLocaleDateString() : 'N/A'}
                </td>
                <td className="py-4 px-4">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setSelectedOrder(order)}
                      className="p-2 hover:bg-brand-peach/20 rounded-full text-brand-peach transition-colors"
                    >
                      <Edit size={18} />
                    </button>
                    <button 
                      onClick={() => handleDelete(order.id!)}
                      disabled={isDeleting}
                      className="p-2 hover:bg-red-500/20 rounded-full text-red-500 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {selectedOrder && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-[var(--bg-primary)] w-full max-w-2xl rounded-[40px] overflow-hidden p-8 border border-[var(--border-color)] shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8 text-[var(--text-primary)]">
                <h2 className="text-2xl font-bold">{t.admin.sales.details} #{selectedOrder.order_number}</h2>
                <button onClick={() => setSelectedOrder(null)} className="hover:rotate-90 transition-transform"><X /></button>
              </div>

              <div className="grid md:grid-cols-2 gap-8 mb-8">
                <div>
                  <h4 className="text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.sales.customer}</h4>
                  <p className="font-bold text-[var(--text-primary)]">{selectedOrder.customer_name}</p>
                  <p className="text-sm text-[var(--text-secondary)]">{selectedOrder.customer_email}</p>
                  <p className="text-sm text-[var(--text-secondary)]">{selectedOrder.customer_phone}</p>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.sales.shippingMethod}</h4>
                  <p className="font-bold text-[var(--text-primary)]">{selectedOrder.shipping_method}</p>
                  {selectedOrder.shipping_method === 'Envio a domicilio' && (
                    <p className="text-sm text-[var(--text-secondary)]">{selectedOrder.shipping_address}</p>
                  )}
                </div>
              </div>

              <div className="bg-[var(--bg-secondary)] rounded-3xl p-6 mb-8 border border-[var(--border-color)]">
                <h4 className="text-xs font-bold uppercase text-[var(--text-secondary)] mb-4">Productos</h4>
                <div className="space-y-4">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="flex flex-col text-sm text-[var(--text-primary)] border-b border-[var(--border-color)] pb-2 last:border-0 last:pb-0">
                      <div className="flex justify-between">
                        <span className="font-bold">{item.name} x {item.quantity}</span>
                        <span className="font-bold">${item.price * item.quantity}</span>
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] mt-1 space-y-0.5">
                        {item.selectedSize && <p>Talle: {item.selectedSize}</p>}
                        {item.selectedColor && (
                          <div className="flex items-center gap-1">
                            <span>Color:</span>
                            <div className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: item.selectedColor }} />
                          </div>
                        )}
                        {item.selectedDynamicFilters && Object.entries(item.selectedDynamicFilters).map(([key, value]) => (
                          <p key={key}>{key}: {value}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="pt-4 border-t border-[var(--border-color)] flex justify-between font-bold text-lg text-[var(--text-primary)]">
                    <span>Total</span>
                    <span>${selectedOrder.total}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => handlePrint('order')}
                  className="flex-1 bg-brand-peach text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg"
                >
                  <Send size={18} /> {t.admin.sales.printOrder}
                </button>
                <button 
                  onClick={() => handlePrint('delivery')}
                  className="flex-1 border-2 border-brand-peach py-4 rounded-2xl font-bold flex items-center justify-center gap-2 text-brand-peach hover:bg-brand-peach hover:text-white transition-all"
                >
                  <Package size={18} /> {t.admin.sales.printDelivery}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ProductCard: React.FC<{ 
  product: Product, 
  t: any, 
  onAddToCart: (p: Product) => void,
  onWishlistToggle?: (productId: string | number) => void,
  isInWishlist?: boolean
}> = ({ product, t, onAddToCart, onWishlistToggle, isInWishlist }) => {
  const navigate = useNavigate();
  const discountedPrice = product.discount_percentage ? product.price * (1 - product.discount_percentage / 100) : product.price;

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      try {
        await navigator.share({
          title: product.name,
          text: product.description,
          url: `${window.location.origin}/product/${product.id}`,
        });
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Error sharing:', error);
        }
      }
    } else {
      // Fallback for browsers that don't support Web Share API
      const url = `${window.location.origin}/product/${product.id}`;
      navigator.clipboard.writeText(url);
      alert(t.productPage.linkCopied || 'Enlace copiado al portapapeles');
    }
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => navigate(`/product/${product.id}`)}
      className="group cursor-pointer"
    >
      <div className="aspect-[3/4] overflow-hidden bg-brand-nude rounded-2xl mb-4 relative">
        <img 
          src={product.image_url || 'https://picsum.photos/seed/fashion/600/800'} 
          alt={product.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          referrerPolicy="no-referrer"
        />
        {product.discount_percentage && product.discount_percentage > 0 && (
          <div className="absolute top-4 left-4 z-10">
            <div className="bg-brand-peach text-white px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-lg animate-pulse">
              {product.discount_percentage}% OFF
            </div>
          </div>
        )}
        {(!product.stock || product.stock === 0) && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-20">
            <span className="bg-black text-white px-4 py-2 rounded-full text-sm font-bold uppercase tracking-widest">NO DISPONIBLE</span>
          </div>
        )}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          {onWishlistToggle && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                if (onWishlistToggle) {
                  onWishlistToggle(product.id!);
                }
              }}
              className={`bg-white/80 backdrop-blur-md p-3 rounded-full shadow-lg transition-all flex items-center justify-center ${isInWishlist ? 'text-red-500' : 'text-brand-dark hover:bg-brand-peach hover:text-white'}`}
            >
              <Icons.Heart size={20} fill={isInWishlist ? "currentColor" : "none"} />
            </button>
          )}
          <button 
            onClick={handleShare}
            className="bg-white/80 backdrop-blur-md text-brand-dark p-3 rounded-full shadow-lg hover:bg-brand-peach hover:text-white transition-all flex items-center justify-center"
          >
            <Icons.Share2 size={20} />
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              const hasOptions = (product.sizes && product.sizes.length > 0) || (product.colors && product.colors.length > 0) || (product.filters && Object.keys(product.filters).length > 0);
              if (hasOptions) {
                navigate(`/product/${product.id}`);
              } else {
                onAddToCart(product);
              }
            }}
            disabled={product.stock === 0}
            className="bg-white/80 backdrop-blur-md text-brand-dark p-3 rounded-full shadow-lg hover:bg-brand-peach hover:text-white transition-all disabled:opacity-50 flex items-center justify-center"
          >
            <ShoppingBag size={20} />
          </button>
        </div>
      </div>
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-medium text-lg tracking-tight text-[var(--text-primary)]">{product.name}</h3>
          <p className="text-[var(--text-secondary)] text-sm">{product.category}</p>
        </div>
        <div className="text-right">
          {product.discount_percentage ? (
            <>
              <p className="text-xs text-[var(--text-secondary)] line-through opacity-60">${product.price.toLocaleString()}</p>
              <p className="font-bold text-brand-peach text-lg">${discountedPrice.toLocaleString()}</p>
            </>
          ) : (
            <p className="font-bold text-brand-peach text-lg">${product.price.toLocaleString()}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const OffersCarousel: React.FC<{ 
  products: Product[], 
  t: any, 
  onAddToCart: (p: Product) => void,
  onWishlistToggle?: (productId: string | number) => void,
  wishlist?: WishlistItem[]
}> = ({ products, t, onAddToCart, onWishlistToggle, wishlist = [] }) => {
  const navigate = useNavigate();
  const offers = products.filter(p => p.discount_percentage && p.discount_percentage > 0);
  const uniqueOffers: Product[] = Array.from(new Map<string | number, Product>(offers.map(p => [p.id, p])).values());
  
  const controls = useAnimation();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % uniqueOffers.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [uniqueOffers.length]);

  useEffect(() => {
    controls.start({ x: -index * 216 }); // 200px width + 16px gap
  }, [index, controls]);

  if (uniqueOffers.length === 0) return null;

  return (
    <section className="py-20 bg-brand-nude/10 dark:bg-white/5 overflow-hidden transition-colors">
      <div className="max-w-7xl mx-auto px-6 mb-12 flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-bold tracking-tighter mb-2 uppercase text-[var(--text-primary)]">{t.home.offers}</h2>
          <p className="text-brand-peach font-medium">{t.home.offersSubtitle}</p>
        </div>
        <button 
          onClick={() => navigate('/catalogo')}
          className="text-[var(--text-primary)] font-bold text-sm uppercase tracking-widest border-b-2 border-brand-peach pb-1 hover:text-brand-peach transition-colors"
        >
          {t.catalog.all}
        </button>
      </div>

      {/* Desktop Grid */}
      <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-6 px-6 max-w-7xl mx-auto">
        {uniqueOffers.map((product) => (
          <ProductCard 
            key={product.id} 
            product={product} 
            t={t} 
            onAddToCart={onAddToCart} 
            onWishlistToggle={onWishlistToggle}
            isInWishlist={wishlist.some(item => String(item.productId) === String(product.id))}
          />
        ))}
      </div>

      {/* Mobile/Tablet Carousel */}
      <div className="md:hidden px-6 overflow-hidden">
        <motion.div 
          className="flex gap-4"
          animate={controls}
          drag="x"
          dragConstraints={{ right: 0, left: -(uniqueOffers.length * 216 - 300) }}
        >
          {uniqueOffers.map((product) => (
            <div key={product.id} className="min-w-[200px] w-[200px]">
              <ProductCard 
                product={product} 
                t={t} 
                onAddToCart={onAddToCart} 
                onWishlistToggle={onWishlistToggle}
                isInWishlist={wishlist.some(item => String(item.productId) === String(product.id))}
              />
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

const HeroBanner = ({ banners, t, onCategoryClick }: { banners: Banner[], t: any, onCategoryClick: (cat: string) => void }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % banners.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [banners.length]);

  if (banners.length === 0) return (
    <header className="pt-6 pb-8 md:pt-8 md:pb-12 lg:pt-10 lg:pb-16 px-6 max-w-7xl mx-auto grid md:grid-cols-2 gap-8 md:gap-12 items-center">
      <motion.div initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col items-center md:items-start text-center md:text-left">
        <h1 className="text-4xl sm:text-5xl md:text-4xl lg:text-6xl xl:text-7xl font-bold tracking-tighter leading-none mb-6 text-[var(--text-primary)] break-words">
          {t.hero.title} <br /> <span className="text-brand-peach">{t.hero.subtitle}</span>
        </h1>
        <p className="text-[var(--text-secondary)] text-lg mb-8 max-w-md">{t.hero.description}</p>
        <button 
          onClick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })}
          className="bg-brand-peach text-white px-8 py-4 rounded-full flex items-center gap-2 hover:opacity-90 transition-colors group shadow-lg"
        >
          {t.hero.button} <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </motion.div>
      <div className="aspect-square bg-[var(--bg-secondary)] rounded-[40px] overflow-hidden border border-[var(--border-color)]">
        <img src="https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=80&w=2070&auto=format&fit=crop" alt="Hero" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      </div>
    </header>
  );

  const banner = banners[currentIndex];
  const style = banner.style || 'full-width';

  return (
    <div className={`relative w-full overflow-hidden ${style === 'full-width' ? 'h-[80vh] md:h-[90vh]' : 'bg-[var(--bg-primary)] flex items-center pt-6 pb-8 md:pt-8 md:pb-12 lg:pt-10 lg:pb-16'}`}>
      <AnimatePresence mode="wait">
        {style === 'full-width' ? (
          <motion.div
            key={banner.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: "easeInOut" }}
            className="absolute inset-0"
          >
            <div 
              className="absolute inset-0 bg-cover bg-center"
              style={{ 
                backgroundImage: `url(${banner.image_url})`,
                backgroundAttachment: banner.is_fixed ? 'fixed' : 'scroll'
              }}
            >
              <div className="absolute inset-0 bg-black/30" />
            </div>
            <div className="relative h-full flex flex-col items-center justify-center text-center text-white px-6">
              <motion.h1 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-4xl sm:text-5xl md:text-6xl lg:text-8xl font-bold tracking-tighter mb-4 uppercase break-words"
              >
                {banner.title}
              </motion.h1>
              <motion.p 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-xl md:text-2xl font-light mb-8 max-w-2xl"
              >
                {banner.subtitle}
              </motion.p>
              <motion.button
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.9 }}
                onClick={() => onCategoryClick(banner.button_link)}
                className="bg-white text-brand-dark px-10 py-4 rounded-full font-bold uppercase tracking-widest hover:bg-brand-peach hover:text-white transition-all"
              >
                {banner.button_text}
              </motion.button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={banner.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="w-full max-w-7xl mx-auto px-6 grid md:grid-cols-2 gap-8 md:gap-12 items-center"
          >
            <div className={`flex flex-col justify-center items-center md:items-start text-center md:text-left order-2 ${style === 'split-right' ? 'md:order-1' : 'md:order-2'}`}>
              <motion.h1 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-4xl sm:text-5xl md:text-4xl lg:text-6xl xl:text-7xl font-black tracking-tighter leading-[0.9] mb-6 uppercase break-words"
              >
                <span className="text-[var(--text-primary)] block">{banner.title.split(' ').slice(0, Math.ceil(banner.title.split(' ').length / 2)).join(' ')}</span>
                {banner.title.split(' ').slice(Math.ceil(banner.title.split(' ').length / 2)).join(' ') && <span className="text-brand-peach block opacity-80">{banner.title.split(' ').slice(Math.ceil(banner.title.split(' ').length / 2)).join(' ')}</span>}
              </motion.h1>
              <motion.p 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-[var(--text-secondary)] text-lg mb-8 max-w-md"
              >
                {banner.subtitle}
              </motion.p>
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                <button
                  onClick={() => onCategoryClick(banner.button_link)}
                  className="bg-brand-peach/40 text-[var(--text-primary)] px-8 py-4 rounded-full font-medium hover:bg-brand-peach hover:text-white transition-all flex items-center gap-2 w-fit"
                >
                  {banner.button_text} <ArrowRight size={18} />
                </button>
              </motion.div>
            </div>
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className={`aspect-square w-full max-w-[500px] mx-auto rounded-[40px] overflow-hidden shadow-2xl order-1 ${style === 'split-right' ? 'md:order-2' : 'md:order-1'}`}
            >
              <img 
                src={banner.image_url} 
                alt={banner.title} 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const FeaturedCategory = ({ 
  category, 
  products, 
  layout, 
  t, 
  onAddToCart,
  onWishlistToggle,
  wishlist = []
}: { 
  category: string, 
  products: Product[], 
  layout: string, 
  t: any, 
  onAddToCart: (p: Product) => void,
  onWishlistToggle?: (productId: string | number) => void,
  wishlist?: WishlistItem[]
}) => {
  const filtered = products.filter(p => p.category === category).slice(0, 4);
  if (filtered.length === 0) return null;

  return (
    <section className="py-24 px-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-end mb-12">
        <div>
          <span className="text-brand-peach font-bold uppercase tracking-widest text-xs mb-2 block">Destacado</span>
          <h2 className="text-4xl font-bold tracking-tighter uppercase text-[var(--text-primary)]">{category}</h2>
        </div>
      </div>

      {layout === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {filtered.map(product => (
            <ProductCard 
              key={product.id} 
              product={product} 
              t={t} 
              onAddToCart={onAddToCart} 
              onWishlistToggle={onWishlistToggle}
              isInWishlist={wishlist.some(item => item.productId === String(product.id))}
            />
          ))}
        </div>
      )}

      {layout === 'list' && (
        <div className="space-y-8">
          {filtered.map(product => (
            <div key={product.id} className="flex flex-col md:flex-row gap-8 items-center bg-[var(--bg-primary)] border border-[var(--border-color)] p-6 rounded-[40px]">
              <img src={product.image_url || undefined} alt={product.name} className="w-48 h-48 object-cover rounded-3xl" />
              <div className="flex-1">
                <h3 className="text-2xl font-bold mb-2 text-[var(--text-primary)]">{product.name}</h3>
                <p className="text-[var(--text-secondary)] mb-4 line-clamp-2">{product.description}</p>
                <span className="text-2xl font-bold text-brand-peach">${product.price.toLocaleString()}</span>
              </div>
              <button 
                onClick={() => onAddToCart(product)}
                className="bg-brand-peach text-white px-8 py-4 rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg"
              >
                {t.catalog.add}
              </button>
            </div>
          ))}
        </div>
      )}

      {layout === 'featured' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 relative h-[600px] rounded-[60px] overflow-hidden group">
            <img src={filtered[0].image_url || undefined} alt={filtered[0].name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-12 text-white">
              <h3 className="text-4xl font-bold mb-4">{filtered[0].name}</h3>
              <button 
                onClick={() => onAddToCart(filtered[0])}
                className="bg-white text-brand-dark px-8 py-3 rounded-full font-bold w-fit"
              >
                {t.catalog.add}
              </button>
            </div>
          </div>
          <div className="space-y-8">
            {filtered.slice(1, 3).map(product => (
              <div key={product.id} className="relative h-[284px] rounded-[40px] overflow-hidden group">
                <img src={product.image_url || undefined} alt={product.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button 
                    onClick={() => onAddToCart(product)}
                    className="bg-white text-brand-dark px-6 py-2 rounded-full font-bold"
                  >
                    {t.catalog.add}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

const CategoryCard: React.FC<{ category: Category, onClick: () => void }> = ({ category, onClick }) => (
  <motion.div 
    whileHover={{ y: -10 }}
    onClick={onClick}
    className="relative aspect-square rounded-[40px] overflow-hidden cursor-pointer group"
  >
    <img 
      src={category.image_url || undefined} 
      alt={category.name} 
      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
      referrerPolicy="no-referrer"
    />
    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-8">
      <h3 className="text-2xl font-bold text-white mb-2">{category.name}</h3>
      <p className="text-white/70 text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        {category.description}
      </p>
    </div>
  </motion.div>
);

const urlToBase64 = async (url: string, maxWidth = 1024, maxHeight = 1024): Promise<string> => {
  if (!url) return '';
  try {
    const res = await fetch(url, { mode: 'cors' });
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    
    const canvas = document.createElement('canvas');
    let width = bitmap.width;
    let height = bitmap.height;

    if (width > height) {
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
    } else {
      if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(bitmap, 0, 0, width, height);
    
    return new Promise((resolve) => {
      canvas.toBlob((b) => {
        if (!b) {
          resolve('');
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(b);
      }, 'image/jpeg', 0.8);
    });
  } catch (e) {
    console.error("Error converting and resizing image to base64", e);
    return '';
  }
};

const resizeBase64 = async (base64: string, maxWidth = 1024, maxHeight = 1024): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64.split(',')[1]);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(base64.split(',')[1]);
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve((reader.result as string).split(',')[1]);
        };
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.8);
    };
    img.src = base64;
  });
};

const VirtualTryOnModal = ({ 
  isOpen, 
  onClose, 
  product, 
  t, 
  onAddToCart,
  onExhausted
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  product: Product, 
  t: any, 
  onAddToCart: (p: Product) => void,
  onExhausted?: () => void
}) => {
  const [step, setStep] = useState<'selection' | 'upload' | 'camera' | 'generating' | 'result'>('selection');
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (step === 'camera' && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [step, stream]);

  const startCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Tu navegador o dispositivo no soporta el acceso a la cámara.");
      return;
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      setStream(s);
      setStep('camera');
    } catch (err: any) {
      console.error("Camera access error:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError("Acceso denegado. Por favor, permite el uso de la cámara en la configuración de tu navegador.");
      } else {
        setError("No se pudo acceder a la cámara. Asegúrate de que no esté siendo usada por otra aplicación.");
      }
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setUserPhoto(dataUrl);
        stopCamera();
        generateLook(dataUrl);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressedImage = await compressImage(file);
        setUserPhoto(compressedImage);
      } catch (error) {
        console.error("Error compressing image:", error);
        alert("Error al procesar la imagen.");
      }
    }
  };

  const generateLook = async (photo: string) => {
    setStep('generating');
    setError(null);
    const apiKey = getApiKey();
    if (!apiKey) {
      setError(t.virtualTryOn.error);
      setStep('selection');
      return;
    }

    try {
      const genAI = new GoogleGenAI({ apiKey });
      
      const productImgUrl = (product.gallery && product.gallery.length > 1) 
        ? product.gallery[1] 
        : product.image_url;

      const [userPhotoResized, productImgResized] = await Promise.all([
        resizeBase64(photo),
        urlToBase64(productImgUrl)
      ]);

      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: userPhotoResized
              }
            },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: productImgResized
              }
            },
            {
              text: `IMAGE 1: A photo of a person.
              IMAGE 2: A photo of a clothing item (${product.name}).
              TASK: Generate a new image of the person from IMAGE 1 wearing the EXACT clothing item from IMAGE 2.
              STRICT RULES:
              1. The person's face, hair, and body shape must remain identical to IMAGE 1.
              2. The background and pose must remain identical to IMAGE 1.
              3. The clothing item from IMAGE 2 must be perfectly fitted onto the person.
              4. Match the texture, color, and details of the clothing in IMAGE 2 exactly.
              5. Do not add any other accessories or change other parts of the outfit.
              6. If IMAGE 2 is a pair of pants, replace only the pants. If it's a top, replace only the top.`
            }
          ]
        },
        config: {
          imageConfig: {
            aspectRatio: "3:4",
            imageSize: "1K"
          }
        }
      });

      let imgFound = false;
      const candidates = (response as any).candidates;
      if (candidates && candidates[0] && candidates[0].content && candidates[0].content.parts) {
        for (const part of candidates[0].content.parts) {
          if (part.inlineData) {
            setGeneratedImage(`data:image/png;base64,${part.inlineData.data}`);
            setStep('result');
            imgFound = true;
            break;
          }
        }
      }

      if (!imgFound) throw new Error("No image generated");

    } catch (err: any) {
      console.error(err);
      const errMsg = err.message?.toLowerCase() || '';
      if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('exhausted')) {
        if (onExhausted) onExhausted();
        setError("Se ha alcanzado el límite diario de generaciones. Por favor, intenta mañana.");
      } else {
        setError(t.virtualTryOn.error);
      }
      setStep('selection');
    }
  };

  const handleBuyNow = () => {
    onAddToCart(product);
    onClose();
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[var(--bg-primary)] w-full max-w-4xl rounded-[40px] overflow-hidden relative max-h-[90vh] flex flex-col shadow-2xl border border-[var(--border-color)]"
      >
        <button 
          onClick={() => {
            stopCamera();
            onClose();
          }} 
          className="absolute top-6 right-6 p-3 bg-brand-peach text-brand-dark hover:bg-brand-dark hover:text-white rounded-full z-[120] shadow-xl transition-all"
          aria-label="Close"
        >
          <X size={24} />
        </button>

        <div className="flex-1 overflow-y-auto p-8 md:p-12">
          {step === 'selection' && (
            <div className="text-center space-y-12 py-10">
              <div className="space-y-4">
                <h2 className="text-3xl md:text-5xl font-bold tracking-tighter uppercase text-[var(--text-primary)]">{t.virtualTryOn.title}</h2>
                <p className="text-[var(--text-secondary)] max-w-md mx-auto">{t.virtualTryOn.selectMode}</p>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <button 
                  onClick={startCamera}
                  className="group p-8 bg-[var(--bg-secondary)] rounded-[40px] border-2 border-transparent hover:border-brand-peach transition-all flex flex-col items-center gap-6"
                >
                  <div className="w-20 h-20 bg-brand-peach/10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Camera className="text-brand-peach" size={40} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold uppercase tracking-tight text-[var(--text-primary)]">{t.virtualTryOn.arMode}</h3>
                    <p className="text-sm text-[var(--text-secondary)]">Usa tu cámara para una prueba en tiempo real</p>
                  </div>
                </button>

                <button 
                  onClick={() => setStep('upload')}
                  className="group p-8 bg-[var(--bg-secondary)] rounded-[40px] border-2 border-transparent hover:border-brand-peach transition-all flex flex-col items-center gap-6"
                >
                  <div className="w-20 h-20 bg-brand-peach/10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <ImagePlus className="text-brand-peach" size={40} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold uppercase tracking-tight text-[var(--text-primary)]">{t.virtualTryOn.photoMode}</h3>
                    <p className="text-sm text-[var(--text-secondary)]">Sube una foto y deja que nuestra IA haga el resto</p>
                  </div>
                </button>
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>
          )}

          {step === 'camera' && (
            <div className="relative h-full flex flex-col items-center">
              <div className="w-full max-w-md aspect-[3/4] bg-black rounded-[40px] overflow-hidden relative border-4 border-brand-peach/20">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted
                  onLoadedMetadata={() => videoRef.current?.play()}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 border-[40px] border-black/20 pointer-events-none" />
              </div>
              
              <div className="mt-8 flex gap-4">
                <button 
                  onClick={() => {
                    stopCamera();
                    setStep('selection');
                  }}
                  className="p-4 bg-[var(--bg-secondary)] rounded-full hover:bg-[var(--bg-secondary)]/80 transition-colors text-[var(--text-primary)]"
                >
                  <ArrowRight className="rotate-180" size={24} />
                </button>
                <button 
                  onClick={capturePhoto}
                  className="bg-brand-peach text-white px-10 py-4 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-transform shadow-xl shadow-brand-peach/20"
                >
                  Vestirme 😀
                </button>
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </div>
          )}

          {step === 'upload' && (
            <div className="text-center space-y-8">
              <div className="space-y-4">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tighter uppercase text-[var(--text-primary)]">{t.virtualTryOn.uploadTitle}</h2>
                <p className="text-[var(--text-secondary)] max-w-md mx-auto">{t.virtualTryOn.uploadDesc}</p>
              </div>

              <div className="grid md:grid-cols-2 gap-8 items-center">
                <div className="bg-[var(--bg-secondary)] p-8 rounded-3xl text-left space-y-4 border border-[var(--border-color)]">
                  <h3 className="font-bold uppercase tracking-widest text-xs text-brand-peach">Recomendaciones</h3>
                  <ul className="space-y-3">
                    {t.virtualTryOn.recommendations.map((rec: string, i: number) => (
                      <li key={i} className="flex items-center gap-3 text-sm text-[var(--text-primary)]">
                        <div className="w-1.5 h-1.5 bg-brand-peach rounded-full" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>

                {!userPhoto ? (
                  <label className="aspect-[3/4] border-2 border-dashed border-brand-peach/30 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:bg-brand-peach/5 transition-colors group">
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                    <div className="w-16 h-16 bg-brand-peach/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <ImagePlus className="text-brand-peach" size={32} />
                    </div>
                    <span className="font-bold uppercase tracking-widest text-xs text-[var(--text-primary)]">{t.virtualTryOn.uploadTitle}</span>
                  </label>
                ) : (
                  <div className="space-y-4">
                    <div className="aspect-[3/4] rounded-3xl overflow-hidden border-2 border-brand-peach">
                      <img src={userPhoto} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                    <button 
                      onClick={() => generateLook(userPhoto)}
                      className="w-full bg-brand-peach text-white py-4 rounded-full font-bold hover:scale-105 transition-transform shadow-xl shadow-brand-peach/20"
                    >
                      Vestirme 😀
                    </button>
                    <button 
                      onClick={() => setUserPhoto(null)}
                      className="text-xs text-[var(--text-secondary)] hover:text-brand-peach transition-colors"
                    >
                      Cambiar foto
                    </button>
                  </div>
                )}
              </div>
              
              <button 
                onClick={() => setStep('selection')}
                className="text-[var(--text-secondary)] font-bold uppercase tracking-widest text-xs hover:text-brand-peach transition-colors"
              >
                Volver
              </button>
            </div>
          )}

          {step === 'generating' && (
            <div className="h-full flex flex-col items-center justify-center space-y-8 py-20">
              <div className="relative">
                <div className="w-24 h-24 border-4 border-brand-peach/20 border-t-brand-peach rounded-full animate-spin" />
                <Wand2 className="absolute inset-0 m-auto text-brand-peach animate-pulse" size={32} />
              </div>
              <p className="text-xl font-medium animate-pulse text-[var(--text-primary)]">{t.virtualTryOn.generating}</p>
            </div>
          )}

          {step === 'result' && (
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="aspect-[3/4] rounded-3xl overflow-hidden shadow-2xl border border-[var(--border-color)]">
                <img src={generatedImage!} alt="Result" className="w-full h-full object-cover" />
              </div>
              <div className="space-y-8">
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold tracking-tighter uppercase text-[var(--text-primary)]">{t.virtualTryOn.resultTitle}</h2>
                  <p className="text-[var(--text-secondary)]">{product.name}</p>
                </div>

                <div className="space-y-4">
                  <button 
                    onClick={() => handleBuyNow()}
                    className="w-full bg-brand-peach text-brand-dark py-5 rounded-2xl font-bold text-xl hover:scale-[1.02] transition-transform shadow-xl shadow-brand-peach/40"
                  >
                    {t.virtualTryOn.buyNow}
                  </button>
                  <button 
                    onClick={() => {
                      onAddToCart(product);
                      onClose();
                    }}
                    className="w-full border-2 border-[var(--border-color)] text-[var(--text-primary)] py-5 rounded-2xl font-bold text-lg hover:bg-[var(--bg-secondary)] transition-all"
                  >
                    {t.virtualTryOn.addToCart}
                  </button>
                  <button 
                    onClick={() => setStep('selection')}
                    className="w-full text-[var(--text-secondary)] font-bold uppercase tracking-widest text-xs hover:text-brand-peach transition-colors"
                  >
                    {t.virtualTryOn.retry}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const ProductPage = ({ 
  products, 
  filters,
  t, 
  onAddToCart,
  onWishlistToggle,
  wishlist = []
}: { 
  products: Product[], 
  filters: Filter[],
  t: any, 
  onAddToCart: (p: Product, options?: { size?: string, color?: string, dynamicFilters?: Record<string, string> }) => void,
  onWishlistToggle?: (productId: string | number) => void,
  wishlist?: WishlistItem[]
}) => {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isTryOnOpen, setIsTryOnOpen] = useState(false);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string>('');
  const { isExhausted, timeLeft, setExhausted } = useGeminiQuota();
  
  const [reviews, setReviews] = useState<Review[]>([]);
  const [newReview, setNewReview] = useState({ rating: 5, comment: '' });
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  const product = products.find(p => String(p.id) === String(id));
  const relatedProducts = products
    .filter(p => p.category === product?.category && p.id !== product?.id)
    .slice(0, 4);

  useEffect(() => {
    if (id) {
      getReviews(id).then(setReviews).catch(err => {
        console.error(err);
        if (err.message && (err.message.includes('Quota') || err.message.includes('quota') || err.message.includes('429') || err.message.includes('403'))) {
          // Can't easily set quotaExceeded here because it's in the main App component,
          // but logging is fine.
        }
      });
    }
  }, [id]);

  const handleAddReview = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser || !id) return;
    setIsSubmittingReview(true);
    try {
      const review: Review = {
        productId: id,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email || 'Usuario',
        rating: newReview.rating,
        comment: newReview.comment,
        createdAt: new Date().toISOString()
      };
      await addReview(review);
      setReviews(prev => [review, ...prev]);
      setNewReview({ rating: 5, comment: '' });
    } catch (error) {
      console.error("Error adding review:", error);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const isInWishlist = wishlist.some(item => String(item.productId) === String(id));

  useEffect(() => {
    window.scrollTo(0, 0);
    if (product) {
      setActiveImage(product.image_url);
      setSelectedSize('');
      setSelectedColor('');
    }
  }, [id, product]);

  if (!product) return (
    <div className="pt-32 pb-20 text-center">
      <h2 className="text-2xl font-bold">Producto no encontrado</h2>
      <button onClick={() => navigate('/')} className="mt-4 text-brand-peach underline">Volver al inicio</button>
    </div>
  );

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomPos({ x, y });
  };

  const images = [product.image_url, ...(product.gallery || [])].filter(Boolean);

  const isClothing = product.category?.toLowerCase().includes('indumentaria') || 
                     product.category?.toLowerCase().includes('remeras') ||
                     product.category?.toLowerCase().includes('jeans') ||
                     product.category?.toLowerCase().includes('vestidos');

  return (
    <div className="pt-24 pb-20 px-6 max-w-7xl mx-auto">
      <button 
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-[var(--text-secondary)] hover:text-brand-peach transition-colors mb-8 group"
      >
        <ArrowRight className="rotate-180 group-hover:-translate-x-1 transition-transform" size={20} />
        <span className="font-bold uppercase tracking-widest text-xs">{t.productPage.back}</span>
      </button>

      <div className="mb-8 space-y-2">
        <span className="text-brand-peach font-bold uppercase tracking-widest text-xs">{product.category}</span>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tighter uppercase leading-none text-[var(--text-primary)]">{product.name}</h1>
      </div>

      <div className="grid md:grid-cols-2 gap-12 lg:gap-20 mb-24">
        {/* Gallery */}
        <div className="space-y-6">
          <div 
            className="aspect-[3/4] rounded-[40px] overflow-hidden bg-[var(--bg-secondary)] border border-[var(--border-color)] relative cursor-zoom-in"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            onMouseMove={handleMouseMove}
          >
            <motion.img 
              key={activeImage}
              initial={{ opacity: 0 }}
              animate={{ 
                opacity: 1,
                scale: isHovering ? 1.5 : 1,
                transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`
              }}
              transition={{ 
                opacity: { duration: 0.3 },
                scale: { duration: 0.2 },
                transformOrigin: { duration: 0 }
              }}
              src={activeImage || undefined} 
              alt={product.name} 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          
          {images.length > 1 && (
            <div className="grid grid-cols-4 gap-4">
              {images.map((img, i) => (
                <button 
                  key={i} 
                  onClick={() => setActiveImage(img)}
                  className={`aspect-square rounded-2xl overflow-hidden bg-[var(--bg-secondary)] border-2 transition-all ${
                    activeImage === img ? 'border-brand-peach scale-95' : 'border-[var(--border-color)] hover:opacity-80'
                  }`}
                >
                  <img src={img || undefined} alt={`${product.name} ${i}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col justify-center space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {product.discount_percentage && product.discount_percentage > 0 ? (
                <>
                  <p className="text-3xl font-bold text-brand-peach">
                    ${(product.price * (1 - product.discount_percentage / 100)).toLocaleString()}
                  </p>
                  <p className="text-xl font-bold text-[var(--text-secondary)] line-through opacity-50">
                    ${product.price.toLocaleString()}
                  </p>
                  <span className="bg-brand-peach text-white px-3 py-1 rounded-full text-sm font-bold">
                    {product.discount_percentage}% OFF
                  </span>
                </>
              ) : (
                <p className="text-3xl font-bold text-[var(--text-primary)]">${product.price.toLocaleString()}</p>
              )}
            </div>
          </div>

          <p className="text-[var(--text-secondary)] text-lg leading-relaxed">
            {product.description}
          </p>

          <div className="space-y-6">
            {product.sizes && product.sizes.length > 0 && (
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{t.productPage.sizes}</span>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map(size => (
                    <button 
                      key={size} 
                      onClick={() => setSelectedSize(size)}
                      className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center font-bold transition-colors text-[var(--text-primary)] ${selectedSize === size ? 'border-brand-peach bg-brand-peach/10 text-brand-peach' : 'border-[var(--border-color)] hover:border-brand-peach'}`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {product.colors && product.colors.length > 0 && (
              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{t.productPage.colors}</span>
                <div className="flex flex-wrap gap-2">
                  {product.colors.map(color => (
                    <button 
                      key={color} 
                      onClick={() => setSelectedColor(color)}
                      className={`w-10 h-10 rounded-full border-2 p-1 transition-colors ${selectedColor === color ? 'border-brand-peach' : 'border-[var(--border-color)] hover:border-brand-peach'}`}
                    >
                      <div className="w-full h-full rounded-full" style={{ backgroundColor: color }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

          {product.filters && Object.entries(product.filters).map(([key, value]) => (
            <div key={key} className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{key}</span>
              <p className="text-[var(--text-primary)] font-bold">{value}</p>
            </div>
          ))}
          </div>

          <div className="flex flex-col gap-4 pt-4">
            <div className="flex gap-4">
              <button 
                onClick={() => {
                  const hasSizes = product.sizes && product.sizes.length > 0;
                  const hasColors = product.colors && product.colors.length > 0;
                  if (hasSizes && !selectedSize) {
                    alert('Por favor selecciona un talle');
                    return;
                  }
                  if (hasColors && !selectedColor) {
                    alert('Por favor selecciona un color');
                    return;
                  }
                  onAddToCart(product, { size: selectedSize, color: selectedColor });
                }}
                disabled={product.stock === 0}
                className="flex-1 bg-brand-dark text-white dark:bg-white dark:text-brand-dark py-5 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-xl disabled:opacity-50"
              >
                {product.stock === 0 ? t.productPage.outOfStock : t.productPage.addToCart}
              </button>
              
              {onWishlistToggle && (
                <button 
                  onClick={() => onWishlistToggle(product.id!)}
                  className={`p-5 rounded-2xl border-2 transition-all flex items-center justify-center ${isInWishlist ? 'border-red-500 text-red-500 bg-red-50' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-red-500 hover:text-red-500'}`}
                >
                  <Icons.Heart size={24} fill={isInWishlist ? "currentColor" : "none"} />
                </button>
              )}

              <button 
                onClick={async () => {
                  if (navigator.share) {
                    try {
                      await navigator.share({
                        title: product.name,
                        text: product.description,
                        url: window.location.href,
                      });
                    } catch (error) {
                      if (error instanceof Error && error.name !== 'AbortError') {
                        console.error('Error sharing:', error);
                      }
                    }
                  } else {
                    navigator.clipboard.writeText(window.location.href);
                    alert(t.productPage.linkCopied || 'Enlace copiado al portapapeles');
                  }
                }}
                className="p-5 rounded-2xl border-2 border-[var(--border-color)] text-[var(--text-secondary)] hover:border-brand-peach hover:text-brand-peach transition-all flex items-center justify-center"
              >
                <Icons.Share2 size={24} />
              </button>
            </div>
            
            {isClothing && product.stock > 0 && (
              <button 
                onClick={() => setIsTryOnOpen(true)}
                disabled={isExhausted}
                className="w-full bg-brand-peach/10 text-brand-peach py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 hover:bg-brand-peach/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wand2 size={24} />
                {isExhausted ? `Disponible en ${timeLeft}` : t.productPage.virtualTryOn}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Reviews Section */}
      <section className="mb-24 space-y-12">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tighter uppercase text-[var(--text-primary)]">{t.reviews.title}</h2>
          <div className="flex items-center gap-2">
            <Icons.Star className="text-yellow-400 fill-current" size={24} />
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {reviews.length > 0 ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1) : '0.0'}
            </span>
            <span className="text-[var(--text-secondary)]">({reviews.length} {t.reviews.title.toLowerCase()})</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-12">
          {/* Add Review Form */}
          <div className="lg:col-span-1">
            {currentUser ? (
              <form onSubmit={handleAddReview} className="bg-[var(--bg-secondary)] p-8 rounded-[40px] border border-[var(--border-color)] space-y-6">
                <h3 className="text-xl font-bold uppercase tracking-tighter text-[var(--text-primary)]">{t.reviews.writeReview}</h3>
                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{t.reviews.rating}</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setNewReview(prev => ({ ...prev, rating: star }))}
                        className="transition-transform hover:scale-110"
                      >
                        <Icons.Star
                          size={32}
                          className={star <= newReview.rating ? "text-yellow-400 fill-current" : "text-gray-300"}
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">{t.reviews.comment}</label>
                  <textarea
                    value={newReview.comment}
                    onChange={e => setNewReview(prev => ({ ...prev, comment: e.target.value }))}
                    placeholder={t.reviews.placeholder}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl p-4 min-h-[120px] outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)] resize-none"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmittingReview}
                  className="w-full bg-brand-peach text-brand-dark py-4 rounded-2xl font-bold uppercase tracking-widest hover:scale-[1.02] transition-transform shadow-lg shadow-brand-peach/20 disabled:opacity-50"
                >
                  {isSubmittingReview ? t.checkout.processing : t.reviews.submit}
                </button>
              </form>
            ) : (
              <div className="bg-[var(--bg-secondary)] p-8 rounded-[40px] border border-[var(--border-color)] text-center space-y-4">
                <Icons.Lock className="mx-auto text-brand-peach" size={48} />
                <p className="text-[var(--text-secondary)] font-medium">{t.reviews.loginToReview}</p>
              </div>
            )}
          </div>

          {/* Reviews List */}
          <div className="lg:col-span-2 space-y-6">
            {reviews.length > 0 ? (
              reviews.map((review, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="bg-[var(--bg-secondary)] p-8 rounded-[40px] border border-[var(--border-color)] space-y-4"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-brand-peach/10 rounded-full flex items-center justify-center text-brand-peach font-bold text-xl">
                        {review.userName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="font-bold text-[var(--text-primary)]">{review.userName}</h4>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {(() => {
                            const date = review.createdAt;
                            if (!date) return '';
                            if (typeof date === 'string') return new Date(date).toLocaleDateString();
                            if ((date as any).toDate) return (date as any).toDate().toLocaleDateString();
                            if ((date as any).seconds) return new Date((date as any).seconds * 1000).toLocaleDateString();
                            return new Date(date).toLocaleDateString();
                          })()}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Icons.Star
                          key={star}
                          size={16}
                          className={star <= review.rating ? "text-yellow-400 fill-current" : "text-gray-300"}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-[var(--text-secondary)] leading-relaxed">{review.comment}</p>
                </motion.div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-[var(--bg-secondary)] rounded-[40px] border border-[var(--border-color)] border-dashed">
                <Icons.MessageSquare size={64} className="text-[var(--text-secondary)] opacity-20 mb-4" />
                <p className="text-[var(--text-secondary)] font-medium">{t.reviews.noReviews}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <section className="space-y-12">
          <h2 className="text-3xl font-bold tracking-tighter uppercase text-[var(--text-primary)]">{t.productPage.relatedProducts}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {relatedProducts.map(p => (
              <ProductCard 
                key={p.id} 
                product={p} 
                t={t} 
                onAddToCart={onAddToCart} 
                onWishlistToggle={onWishlistToggle}
                isInWishlist={wishlist.some(item => String(item.productId) === String(p.id))}
              />
            ))}
          </div>
        </section>
      )}

      <VirtualTryOnModal 
        isOpen={isTryOnOpen} 
        onClose={() => setIsTryOnOpen(false)} 
        product={product} 
        t={t} 
        onAddToCart={(p) => {
          if (product.sizes && product.sizes.length > 0 && !selectedSize) {
            alert('Por favor selecciona un talle antes de agregar al carrito');
            return;
          }
          if (product.colors && product.colors.length > 0 && !selectedColor) {
            alert('Por favor selecciona un color antes de agregar al carrito');
            return;
          }
          onAddToCart(p, { size: selectedSize, color: selectedColor });
        }} 
        onExhausted={setExhausted}
      />
    </div>
  );
};

const ChatBot = ({ products, orders, settings, t }: { products: Product[], orders: Order[], settings: Settings | null, t: any }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const { isExhausted, setExhausted } = useGeminiQuota();

  const handleSend = async () => {
    if (!message.trim()) return;

    const userMsg = message;
    setMessage('');
    setChat(prev => [...prev, { role: 'user', text: userMsg }]);

    if (isExhausted) {
      const waLink = `https://wa.me/${settings?.whatsapp_number}?text=${encodeURIComponent(userMsg)}`;
      window.open(waLink, '_blank');
      setChat(prev => [...prev, { role: 'model', text: settings?.chatbot_unavailable_message || 'El asistente virtual está temporalmente fuera de servicio por alta demanda. Te he redirigido a WhatsApp para que un humano te atienda.' }]);
      return;
    }

    // Check business hours
    const businessHours: BusinessHours = settings?.business_hours 
      ? JSON.parse(settings.business_hours) 
      : { enabled: false, start: '00:00', end: '23:59', days: [0,1,2,3,4,5,6] };

    if (businessHours.enabled) {
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const argentinaTime = new Date(utc + (3600000 * -3));
      const currentDay = argentinaTime.getDay();
      const currentTime = argentinaTime.getHours() * 60 + argentinaTime.getMinutes();
      
      const [startH, startM] = businessHours.start.split(':').map(Number);
      const [endH, endM] = businessHours.end.split(':').map(Number);
      const startTime = startH * 60 + startM;
      const endTime = endH * 60 + endM;

      if (!businessHours.days.includes(currentDay) || currentTime < startTime || currentTime > endTime) {
        setChat(prev => [...prev, { 
          role: 'model', 
          text: `${t.chatbot.outOfHours} https://wa.me/${settings?.whatsapp_number}` 
        }]);
        return;
      }
    }

    const apiKey = settings?.gemini_api_key || getApiKey();
    if (!apiKey) {
      setChat(prev => [...prev, { role: 'model', text: t.chatbot.error }]);
      return;
    }
    
    setLoading(true);

    try {
      const genAI = new GoogleGenAI({ apiKey });
      
      const simplifiedProducts = products.map(p => ({ n: p.name, p: p.price, c: p.category }));
      const simplifiedOrders = orders.map(o => ({ n: o.order_number, s: o.status }));

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          ...chat.map(c => ({ role: c.role, parts: [{ text: c.text }] })),
          { role: "user", parts: [{ text: userMsg }]}
        ],
        config: {
          systemInstruction: `Eres un asistente de ventas experto para la tienda "Sorella Indumentaria". 
            Aquí tienes el catálogo actual: ${JSON.stringify(simplifiedProducts)}. 
            Aquí tienes la lista de pedidos (solo para consultas de estado): ${JSON.stringify(simplifiedOrders)}.
            Si el usuario pregunta por el estado de su pedido, pídele el número de pedido y verifica en la lista.
            Si el usuario pregunta por algo que no tenemos o si la duda es muy compleja, o si quiere hablar con un humano, genera un link de WhatsApp: https://wa.me/${settings?.whatsapp_number}.
            Sé amable, minimalista y profesional. Responde en el mismo idioma que el usuario (Español o Inglés).`
        }
      });

      setChat(prev => [...prev, { role: 'model', text: response.text || t.chatbot.error }]);
    } catch (err: any) {
      console.error("Gemini Error:", err);
      const errMsg = err.message?.toLowerCase() || '';
      if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('exhausted')) {
        setExhausted();
        const waLink = `https://wa.me/${settings?.whatsapp_number}?text=${encodeURIComponent(userMsg)}`;
        window.open(waLink, '_blank');
        setChat(prev => [...prev, { role: 'model', text: settings?.chatbot_unavailable_message || 'El asistente virtual está temporalmente fuera de servicio por alta demanda. Te he redirigido a WhatsApp para que un humano te atienda.' }]);
      } else {
        setChat(prev => [...prev, { role: 'model', text: `${t.chatbot.error} (${err.message || 'Error de conexión'})` }]);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="mb-4 w-80 h-96 glass-morphism rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="p-4 bg-brand-peach text-white flex justify-between items-center">
              <span className="font-medium">{settings?.chatbot_name || t.chatbot.title}</span>
              <button onClick={() => setIsOpen(false)}><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chat.length === 0 && (
                <div className="text-center text-[var(--text-secondary)] text-sm mt-10">
                  {t.chatbot.welcome}
                </div>
              )}
              {chat.map((c, i) => (
                <div key={i} className={`flex ${c.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${c.role === 'user' ? 'bg-brand-peach text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)]'}`}>
                    {c.text}
                  </div>
                </div>
              ))}
              {loading && <div className="text-xs text-[var(--text-secondary)] italic">{t.chatbot.typing}</div>}
            </div>
            <div className="p-4 border-t border-[var(--border-color)] flex gap-2">
              <input 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder={t.chatbot.placeholder}
                className="flex-1 bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-full px-4 py-2 text-sm outline-none border border-[var(--border-color)]"
              />
              <button onClick={handleSend} className="bg-brand-peach text-white p-2 rounded-full">
                <Send size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="bg-brand-peach text-white p-4 rounded-full shadow-lg hover:scale-110 transition-transform"
      >
        <MessageSquare size={24} />
      </button>
    </div>
  );
};

const CatalogPage = ({ 
  products, 
  categories, 
  onAddToCart, 
  onTryOn, 
  t, 
  selectedCategory, 
  onCategoryChange,
  selectedSize,
  onSizeChange,
  selectedColor,
  onColorChange,
  selectedPriceSort,
  onPriceSortChange,
  selectedDiscount,
  onDiscountChange,
  title,
  priceRange,
  onPriceRangeChange,
  onOpenFilters,
  filters = [],
  selectedDynamicFilters = {},
  onDynamicFilterChange = () => {},
  onWishlistToggle,
  wishlist = []
}: { 
  products: Product[], 
  categories: Category[], 
  onAddToCart: (p: Product, options?: any) => void, 
  onTryOn: (p: Product) => void, 
  t: any, 
  selectedCategory: string, 
  onCategoryChange: (cat: string) => void,
  selectedSize: string,
  onSizeChange: (size: string) => void,
  selectedColor: string,
  onColorChange: (color: string) => void,
  selectedPriceSort: string,
  onPriceSortChange: (sort: string) => void,
  selectedDiscount: boolean,
  onDiscountChange: (discount: boolean) => void,
  title: string,
  priceRange: [number, number],
  onPriceRangeChange: (range: [number, number]) => void,
  onOpenFilters?: () => void,
  filters?: Filter[],
  selectedDynamicFilters?: Record<string, string>,
  onDynamicFilterChange?: (filterName: string, value: string) => void,
  onWishlistToggle?: (productId: string | number) => void,
  wishlist?: WishlistItem[]
}) => {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedCategory]);

  const filteredProducts = useMemo(() => {
    let result = products.filter(p => {
      const matchesCategory = selectedCategory === 'Todos' || p.category === selectedCategory;
      const matchesPrice = p.price >= priceRange[0] && p.price <= priceRange[1];
      const matchesSize = selectedSize === 'Todos' || (p.sizes && p.sizes.includes(selectedSize));
      const matchesColor = selectedColor === 'Todos' || (p.colors && p.colors.includes(selectedColor));
      const matchesDiscount = !selectedDiscount || (p.discount_percentage && p.discount_percentage > 0);
      
      let matchesDynamic = true;
      for (const [filterName, selectedOption] of Object.entries(selectedDynamicFilters)) {
        if (selectedOption !== 'Todos') {
          if (!p.filters || p.filters[filterName] !== selectedOption) {
            matchesDynamic = false;
            break;
          }
        }
      }

      return matchesCategory && matchesPrice && matchesSize && matchesColor && matchesDiscount && matchesDynamic;
    });

    if (selectedPriceSort === 'asc') {
      result.sort((a, b) => a.price - b.price);
    } else if (selectedPriceSort === 'desc') {
      result.sort((a, b) => b.price - a.price);
    }
    return result;
  }, [products, selectedCategory, priceRange, selectedSize, selectedColor, selectedPriceSort, selectedDiscount, selectedDynamicFilters]);

  const allSizes = useMemo(() => {
    const sizes = new Set<string>();
    products.forEach(p => p.sizes?.forEach(s => sizes.add(s)));
    return Array.from(sizes).sort();
  }, [products]);

  const allColors = useMemo(() => {
    const colors = new Set<string>();
    products.forEach(p => p.colors?.forEach(c => colors.add(c)));
    return Array.from(colors).sort();
  }, [products]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <h1 className="text-4xl font-bold tracking-tighter uppercase text-[var(--text-primary)]">{title}</h1>
        </div>

        <div className="flex flex-col gap-8">

          <div className="flex-1">
            {filteredProducts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredProducts.map((product) => (
                  <ProductCard 
                    key={product.id} 
                    product={product} 
                    onAddToCart={onAddToCart} 
                    onTryOn={onTryOn}
                    t={t}
                    onWishlistToggle={onWishlistToggle}
                    isInWishlist={wishlist.some(item => item.productId === String(product.id))}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-20 bg-[var(--bg-secondary)] rounded-[40px] border border-[var(--border-color)]">
                <p className="text-[var(--text-secondary)] font-medium">{t.catalog.noProducts}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const WishlistPage = ({ 
  products, 
  wishlist, 
  onAddToCart, 
  onWishlistToggle, 
  t 
}: { 
  products: Product[], 
  wishlist: WishlistItem[], 
  onAddToCart: (p: Product, options?: any) => void, 
  onWishlistToggle: (productId: string | number) => void, 
  t: any 
}) => {
  const navigate = useNavigate();
  const wishlistProducts = products.filter(p => wishlist.some(item => String(item.productId) === String(p.id)));

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tighter uppercase text-[var(--text-primary)]">{t.wishlist.title}</h1>
            <p className="text-[var(--text-secondary)] mt-2">{wishlistProducts.length} {t.wishlist.items}</p>
          </div>
        </div>

        {wishlistProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {wishlistProducts.map(product => (
              <ProductCard 
                key={product.id} 
                product={product} 
                t={t} 
                onAddToCart={onAddToCart} 
                onWishlistToggle={onWishlistToggle}
                isInWishlist={true}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-32 bg-[var(--bg-secondary)] rounded-[40px] border border-[var(--border-color)]">
            <Icons.Heart className="mx-auto text-gray-300 mb-6" size={64} />
            <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4">{t.wishlist.empty}</h2>
            <button 
              onClick={() => navigate('/catalogo')}
              className="bg-brand-peach text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest"
            >
              {t.catalog.all}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const AdminAuth = ({ t, settings, onAdminAuth }: { t: any, settings: any, onAdminAuth: () => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [step, setStep] = useState<'email' | 'login' | 'request' | 'setup' | 'pending'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState<any>(null);

  const checkEmail = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const req = await getAdminRequestByEmail(email);
      setRequest(req);
      if (!req) {
        setStep('request');
      } else if (req.status === 'pending') {
        setStep('pending');
      } else if (req.status === 'approved') {
        setStep('setup');
      } else if (req.status === 'completed') {
        setStep('login');
      }
    } catch (err) {
      setError('Error al verificar el email');
    } finally {
      setLoading(false);
    }
  };

  const handleRequest = async () => {
    setLoading(true);
    try {
      await requestAdminAccess(email);
      setStep('pending');
    } catch (err) {
      setError('Error al solicitar acceso');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await loginWithEmail(email, password);
      onAdminAuth();
    } catch (err) {
      setError('Email o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    try {
      // Create user and update request
      const newUserAuth = await registerWithEmail(email, password, { displayName: 'Administrador' });
      await updateAdminRequestStatus(request.id, 'completed');
      // Update user role directly using the new UID
      await updateUserRole(newUserAuth.uid, 'admin', true);
      onAdminAuth();
    } catch (err) {
      setError('Error al crear la cuenta');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
      onAdminAuth();
    } catch (err) {
      setError('Error al iniciar sesión con Google. Asegúrate de que el dominio esté autorizado en Firebase.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto py-12 px-6">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-brand-peach/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <SettingsIcon size={40} className="text-brand-peach" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">Acceso Administrador</h2>
        <p className="text-[var(--text-secondary)] mt-2">Gestión exclusiva para el equipo de Sorella</p>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-2xl text-sm font-medium mb-6 flex items-center gap-2 border border-red-500/20">
          <X size={16} /> {error}
        </div>
      )}

      {step === 'email' && (
        <form onSubmit={checkEmail} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Email Corporativo</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
              placeholder="ejemplo@sorella.com"
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-brand-dark text-white dark:bg-brand-peach dark:text-brand-dark py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-brand-dark/90 dark:hover:opacity-90 transition-all disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Siguiente'}
          </button>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--border-color)]"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[var(--bg-primary)] px-4 text-[var(--text-secondary)] font-bold tracking-widest">O accede con</span>
            </div>
          </div>

          <button 
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-[var(--bg-primary)] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
            Google
          </button>
        </form>
      )}

      {step === 'login' && (
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Contraseña</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-brand-dark text-white dark:bg-brand-peach dark:text-brand-dark py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-brand-dark/90 dark:hover:opacity-90 transition-all disabled:opacity-50"
          >
            {loading ? 'Ingresando...' : 'Iniciar Sesión'}
          </button>
          <button type="button" onClick={() => setStep('email')} className="w-full text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-brand-peach">Volver</button>
        </form>
      )}

      {step === 'request' && (
        <div className="text-center space-y-6">
          <p className="text-[var(--text-secondary)]">Este email no tiene permisos de administrador. ¿Deseas solicitar acceso?</p>
          <button 
            onClick={handleRequest}
            disabled={loading}
            className="w-full bg-brand-peach text-white py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-brand-dark transition-all disabled:opacity-50"
          >
            {loading ? 'Solicitando...' : 'Solicitar Acceso'}
          </button>
          <button type="button" onClick={() => setStep('email')} className="w-full text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-brand-peach">Volver</button>
        </div>
      )}

      {step === 'pending' && (
        <div className="text-center space-y-6">
          <div className="w-16 h-16 bg-yellow-50 dark:bg-yellow-500/10 text-yellow-500 dark:text-yellow-400 rounded-full flex items-center justify-center mx-auto">
            <Clock size={32} />
          </div>
          <div className="space-y-2">
            <h3 className="font-bold text-[var(--text-primary)]">Solicitud Pendiente</h3>
            <p className="text-sm text-[var(--text-secondary)]">Se ha enviado una notificación a dgmvolpi@gmail.com para aprobar tu acceso. Por favor, espera la confirmación.</p>
          </div>
          <button type="button" onClick={() => setStep('email')} className="w-full text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-brand-peach">Verificar de nuevo</button>
        </div>
      )}

      {step === 'setup' && (
        <form onSubmit={handleSetup} className="space-y-4">
          <div className="bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 p-4 rounded-2xl text-sm font-medium mb-6">
            ¡Tu solicitud ha sido aprobada! Crea tu contraseña para finalizar.
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Nueva Contraseña</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-[var(--text-primary)]"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Confirmar Contraseña</label>
            <input 
              type="password" 
              required
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl p-4 outline-none focus:border-brand-peach transition-colors text-gray-900 dark:text-white"
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-gray-900 dark:bg-brand-peach text-white py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-gray-800 dark:hover:opacity-90 transition-all disabled:opacity-50"
          >
            {loading ? 'Creando cuenta...' : 'Finalizar Registro'}
          </button>
        </form>
      )}
    </div>
  );
};

export default function App() {
  return <AppContent />;
}

function AppContent() {
  console.log("App component rendering...");
  const navigate = useNavigate();
  const location = useLocation();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  // Dynamic Title and Favicon
  useEffect(() => {
    if (settings?.gemini_api_key) {
      globalGeminiKey = settings.gemini_api_key;
    }
    if (settings?.logo_text) {
      document.title = settings.logo_text;
    }
    if (settings?.logo_url) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.getElementsByTagName('head')[0].appendChild(link);
      }
      link.href = settings.logo_url;
    }
  }, [settings]);
  const adminEmails = ['dgmvolpi@gmail.com'];
  const [categoryFilter, setCategoryFilter] = useState('Todos');
  const [sizeFilter, setSizeFilter] = useState('Todos');
  const [colorFilter, setColorFilter] = useState('Todos');
  const [selectedDynamicFilters, setSelectedDynamicFilters] = useState<Record<string, string>>({});
  const [priceSort, setPriceSort] = useState('none');
  const [discountFilter, setDiscountFilter] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000000]);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  // Auth & Cart State
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPendingAdmin, setIsPendingAdmin] = useState(false);

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!user) {
        setIsAdmin(false);
        setIsPendingAdmin(false);
        localStorage.removeItem('sorella_admin_status');
        return;
      }

      const isSuperAdmin = user.email?.toLowerCase() === 'dgmvolpi@gmail.com';
      
      const cachedAdmin = localStorage.getItem('sorella_admin_status');
      if (cachedAdmin) {
        try {
          const parsed = JSON.parse(cachedAdmin);
          if (parsed.uid === user.uid) {
            setIsAdmin(parsed.isAdmin);
            setIsPendingAdmin(parsed.isPendingAdmin);
          }
        } catch (e) {}
      }

      try {
        const profile = await getUserProfile(user.uid);
        if (isSuperAdmin) {
          setIsAdmin(true);
          setIsPendingAdmin(false);
          safeSetLocalStorage('sorella_admin_status', JSON.stringify({ uid: user.uid, isAdmin: true, isPendingAdmin: false }));
          return;
        }

        if (profile?.role === 'admin') {
          if (profile.approved) {
            setIsAdmin(true);
            setIsPendingAdmin(false);
            safeSetLocalStorage('sorella_admin_status', JSON.stringify({ uid: user.uid, isAdmin: true, isPendingAdmin: false }));
          } else {
            setIsAdmin(false);
            setIsPendingAdmin(true);
            safeSetLocalStorage('sorella_admin_status', JSON.stringify({ uid: user.uid, isAdmin: false, isPendingAdmin: true }));
          }
        } else {
          setIsAdmin(false);
          setIsPendingAdmin(false);
          safeSetLocalStorage('sorella_admin_status', JSON.stringify({ uid: user.uid, isAdmin: false, isPendingAdmin: false }));
        }
      } catch (error: any) {
        console.error("Error checking admin status", error);
        if (error.message && (error.message.includes('Quota') || error.message.includes('quota') || error.message.includes('429') || error.message.includes('403'))) {
          setQuotaExceeded(true);
        }
      }
    };

    checkAdminStatus();
  }, [user]);

  useEffect(() => {
    if (isAdmin && user?.email?.toLowerCase() === 'dgmvolpi@gmail.com') {
      getAdminRequests().then(setAdminRequests).catch(err => {
        console.error(err);
        if (err.message && (err.message.includes('Quota') || err.message.includes('quota') || err.message.includes('429') || err.message.includes('403'))) {
          setQuotaExceeded(true);
        }
      });
    }
  }, [isAdmin, user]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'data' | 'orders'>('data');
  const [adminRequests, setAdminRequests] = useState<any[]>([]);

  const handleProfileClick = (tab: 'data' | 'orders' = 'data') => {
    setProfileTab(tab);
    setIsProfileOpen(true);
  };

  // Language & Theme State
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('sorella_lang');
    return (saved as Language) || 'es';
  });
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(() => {
    const saved = localStorage.getItem('sorella_theme');
    return (saved as any) || 'auto';
  });

  const t = useMemo(() => translations[language], [language]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        saveUserProfile(u.uid, {
          uid: u.uid,
          displayName: u.displayName,
          email: u.email,
          photoURL: u.photoURL,
          lastLogin: new Date()
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Cart Persistence
  useEffect(() => {
    const savedCart = localStorage.getItem('sorella_cart');
    if (savedCart) {
      try {
        setCart(JSON.parse(savedCart));
      } catch (e) {
        console.error("Error loading cart", e);
      }
    }
  }, []);

  useEffect(() => {
    try {
      safeSetLocalStorage('sorella_cart', JSON.stringify(cart));
    } catch (e) {
      console.warn("Could not save cart to localStorage:", e);
    }
  }, [cart]);

  // Cart Helpers
  const addToCart = (product: Product, options?: { size?: string, color?: string, dynamicFilters?: Record<string, string> }) => {
    if (!user) {
      alert(t.auth?.required || 'Debes iniciar sesión para comprar');
      setIsAuthOpen(true);
      return;
    }
    setCart(prev => {
      const cartItemId = `${product.id}-${options?.size || ''}-${options?.color || ''}-${JSON.stringify(options?.dynamicFilters || {})}`;
      const existing = prev.find(item => item.cartItemId === cartItemId || (!item.cartItemId && String(item.id) === String(product.id)));
      if (existing) {
        return prev.map(item => 
          (item.cartItemId === cartItemId || (!item.cartItemId && String(item.id) === String(product.id))) ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1, cartItemId, selectedSize: options?.size, selectedColor: options?.color, selectedDynamicFilters: options?.dynamicFilters }];
    });
    setIsCartOpen(true);
  };

  useEffect(() => {
    if (user) {
      getWishlist(user.uid).then(setWishlist).catch(err => {
        console.error(err);
        if (err.message && (err.message.includes('Quota') || err.message.includes('quota') || err.message.includes('429') || err.message.includes('403'))) {
          setQuotaExceeded(true);
        }
      });
    } else {
      setWishlist([]);
    }
  }, [user]);

  const toggleWishlist = async (productId: string | number) => {
    if (!user) {
      alert(t.wishlist?.login || 'Es necesario registrarse para poder añadir el producto a la lista de deseos');
      setIsAuthOpen(true);
      return;
    }

    const pId = String(productId);
    const isInWishlist = wishlist.some(item => String(item.productId) === pId);

    try {
      if (isInWishlist) {
        await removeFromWishlist(user.uid, pId);
        setWishlist(prev => prev.filter(item => String(item.productId) !== pId));
      } else {
        await addToWishlist(user.uid, pId);
        setWishlist(prev => [...prev, { userId: user.uid, productId: pId, createdAt: new Date() }]);
      }
    } catch (error) {
      console.error("Error toggling wishlist:", error);
    }
  };

  const updateQuantity = (cartItemIdOrId: string | number, quantity: number) => {
    if (quantity < 1) {
      removeFromCart(cartItemIdOrId);
      return;
    }
    setCart(prev => prev.map(item => 
      (item.cartItemId === String(cartItemIdOrId) || String(item.id) === String(cartItemIdOrId)) ? { ...item, quantity } : item
    ));
  };

  const removeFromCart = (cartItemIdOrId: string | number) => {
    setCart(prev => prev.filter(item => item.cartItemId !== String(cartItemIdOrId) && String(item.id) !== String(cartItemIdOrId)));
  };

  const handleCheckout = () => {
    setIsCartOpen(false);
    if (!user) {
      setIsAuthOpen(true);
      return;
    }
    navigate('/checkout');
  };

  // Theme Logic
  useEffect(() => {
    const applyTheme = () => {
      let currentTheme = theme;
      if (theme === 'auto') {
        currentTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      
      if (currentTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();
    safeSetLocalStorage('sorella_theme', theme);

    if (theme === 'auto') {
      const interval = setInterval(applyTheme, 60000); // Check every minute
      return () => clearInterval(interval);
    }
  }, [theme]);

  useEffect(() => {
    safeSetLocalStorage('sorella_lang', language);
  }, [language]);

  // Admin Form State
  const [adminTab, setAdminTab] = useState<'products' | 'categories' | 'banners' | 'sales' | 'settings' | 'users' | 'requests' | 'marketing' | 'emails' | 'coupons' | 'filters'>('products');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [editingFilter, setEditingFilter] = useState<Filter | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [marketingNumbers, setMarketingNumbers] = useState<{number: string, name: string, source: string}[]>([]);
  const [selectedMarketingNumbers, setSelectedMarketingNumbers] = useState<string[]>([]);
  const [marketingMessage, setMarketingMessage] = useState('');
  const [marketingFile, setMarketingFile] = useState<{name: string, data: string, type: string} | null>(null);
  const [marketingLoading, setMarketingLoading] = useState(false);
  const [marketingProgress, setMarketingProgress] = useState(0);

  useEffect(() => {
    if (adminTab === 'marketing') {
      const uniqueNumbers = new Map<string, {number: string, name: string, source: string}>();
      
      // From Users
      users.forEach(u => {
        if (u.phone) {
          const clean = u.phone.replace(/\D/g, '');
          if (clean) uniqueNumbers.set(clean, { number: clean, name: u.displayName || 'Usuario', source: 'Registro' });
        }
      });

      // From Orders
      orders.forEach(o => {
        if (o.customer_phone) {
          const clean = o.customer_phone.replace(/\D/g, '');
          if (clean) uniqueNumbers.set(clean, { number: clean, name: o.customer_name, source: 'Pedido' });
        }
      });

      setMarketingNumbers(Array.from(uniqueNumbers.values()));
    }
  }, [adminTab, users, orders]);

  const handleMarketingExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws) as any[];
      
      const newNumbers = data.map(row => ({
        number: String(row.Telefono || row.Phone || row.Number || row.number || '').replace(/\D/g, ''),
        name: String(row.Nombre || row.Name || row.name || 'Importado'),
        source: 'Excel'
      })).filter(n => n.number.length >= 8);

      setMarketingNumbers(prev => {
        const unique = new Map(prev.map(n => [n.number, n]));
        newNumbers.forEach(n => unique.set(n.number, n));
        return Array.from(unique.values());
      });
      alert(`${newNumbers.length} números importados correctamente.`);
    };
    reader.readAsBinaryString(file);
  };

  const handleSendMassMessages = async () => {
    const targets = selectedMarketingNumbers.length > 0 
      ? marketingNumbers.filter(n => selectedMarketingNumbers.includes(n.number))
      : marketingNumbers;

    if (targets.length === 0) {
      alert('No hay números seleccionados.');
      return;
    }

    if (!marketingMessage.trim()) {
      alert('El mensaje no puede estar vacío.');
      return;
    }

    if (!confirm(`¿Está seguro de enviar este mensaje a ${targets.length} contactos?`)) return;

    setMarketingLoading(true);
    setMarketingProgress(0);

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      // In a real scenario, we would call an API here.
      // For now, we simulate the process and provide a link for manual sending if needed.
      // Or we could use a service like Twilio/Meta API if configured.
      
      console.log(`Enviando a ${target.number}: ${marketingMessage}`);
      
      // Simulate delay
      await new Promise(resolve => setTimeout(resolve, 800));
      setMarketingProgress(Math.round(((i + 1) / targets.length) * 100));
    }

    setMarketingLoading(false);
    alert('Proceso de envío masivo completado (Simulado). Para envíos reales con adjuntos, se requiere configurar una API de WhatsApp Business.');
  };

  useEffect(() => {
    if (adminTab === 'users') {
      getUsers().then(data => setUsers(data || [])).catch(err => {
        console.error(err);
        if (err.message && (err.message.includes('Quota') || err.message.includes('quota') || err.message.includes('429') || err.message.includes('403'))) {
          setQuotaExceeded(true);
        }
      });
    }
  }, [adminTab]);
  const [apiStatus, setApiStatus] = useState({ mercadopago: false, whatsapp: false, gemini: false });
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiCategoryPrompt, setAiCategoryPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiIconPrompts, setAiIconPrompts] = useState<{[key: string]: string}>({});
  const { isExhausted, timeLeft, setExhausted } = useGeminiQuota();

  const handleAiIconGenerate = async (index: number, prompt: string, baseImage?: string) => {
    if (isExhausted) {
      alert(`Se ha alcanzado el límite diario de generaciones. Disponible en ${timeLeft}`);
      return;
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      await checkAndOpenApiKey();
    }
    const finalApiKey = getApiKey();
    if (!finalApiKey) return;

    setAiLoading(true);
    try {
      const genAI = new GoogleGenAI({ apiKey: finalApiKey });
      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [
            ...(baseImage ? [{ inlineData: { data: baseImage.split(',')[1], mimeType: "image/png" } }] : []),
            { text: `Generate a minimalist icon for a menu item. 
              Prompt: ${prompt}. 
              Style: Flat, minimalist, vector-like icon. 
              Color Palette: Use primarily #E8C2B0 (brand-peach) for the icon lines/shape. 
              Background: Transparent or very clean white. 
              The icon should be a single, clear symbol, professional and elegant.` }
          ]
        }
      });

      let imageUrl = null;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      
      if (imageUrl) {
        const compressedImage = await compressBase64Image(imageUrl);
        let currentItems: MenuItem[] = [];
        try {
          currentItems = settings?.menu_items ? JSON.parse(settings.menu_items) : [];
        } catch (e) {}
        
        if (currentItems[index]) {
          currentItems[index].icon = compressedImage;
          setSettings(settings ? {...settings, menu_items: JSON.stringify(currentItems)} : null);
        }
      } else {
        alert("No se pudo generar el icono. Intenta con otro prompt.");
      }
    } catch (err: any) {
      console.error(err);
      const errMsg = err.message?.toLowerCase() || '';
      if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('exhausted')) {
        setExhausted();
        alert(`Se ha alcanzado el límite diario de generaciones. Disponible en ${timeLeft || '24h'}`);
      } else {
        alert("Error al generar el icono con IA.");
      }
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [isAdmin]);

  useEffect(() => {
    if (settings?.logo_url) {
      let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.getElementsByTagName('head')[0].appendChild(link);
      }
      link.href = settings.logo_url;
    }
    document.title = "BySorellaStore Indumentaria";
  }, [settings]);

  useEffect(() => {
    if (isAdmin) {
      const q = query(collection(db, 'orders'), orderBy('created_at', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const oData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[];
        setOrders(oData);
      }, (error) => {
        console.error("Error fetching orders:", error);
      });
      return () => unsubscribe();
    }
  }, [isAdmin]);

  useEffect(() => {
    if (settings) {
      console.log("[MP] Status check:", {
        hasPublicKey: !!settings.mercadopago_public_key,
        hasAccessToken: !!settings.mercadopago_access_token,
        publicKeyPrefix: settings.mercadopago_public_key?.substring(0, 10),
        accessTokenPrefix: settings.mercadopago_access_token?.substring(0, 10)
      });
      
      if (settings.mercadopago_public_key) {
        console.log("[MP] Initializing SDK with key:", settings.mercadopago_public_key.substring(0, 10) + "...");
        initMercadoPago(settings.mercadopago_public_key, { locale: 'es-AR' });
      }
    }
  }, [settings]);

  const fetchData = async () => {
    try {
      const cachedSettings = localStorage.getItem('sorella_settings');
      const cachedProducts = localStorage.getItem('sorella_products');
      const cachedCategories = localStorage.getItem('sorella_categories');
      const cachedBanners = localStorage.getItem('sorella_banners');
      const cachedCoupons = localStorage.getItem('sorella_coupons');
      const cachedFilters = localStorage.getItem('sorella_filters');
      
      if (cachedSettings) setSettings(JSON.parse(cachedSettings));
      if (cachedProducts) setProducts(JSON.parse(cachedProducts));
      if (cachedCategories) setCategories(JSON.parse(cachedCategories));
      if (cachedBanners) setBanners(JSON.parse(cachedBanners));
      if (cachedCoupons) setCoupons(JSON.parse(cachedCoupons));
      if (cachedFilters) setFilters(JSON.parse(cachedFilters));

      if (cachedSettings || cachedProducts) {
        setLoading(false);
      }

      const sData = await getSettings() as Settings;
      const [pData, cData, bData, cpData, fData] = await Promise.all([
        getProducts(),
        getCategories(),
        getBanners(),
        getCoupons(),
        getFilters()
      ]);
      
      const newProducts = pData || [];
      const newCategories = cData || [];
      const newBanners = bData || [];
      const newCoupons = cpData || [];
      const newFilters = fData || [];
      const newSettings = sData || null;

      setProducts(newProducts);
      setCategories(newCategories);
      setBanners(newBanners);
      setCoupons(newCoupons);
      setFilters(newFilters);
      setSettings(newSettings);

      try {
        safeSetLocalStorage('sorella_settings', JSON.stringify(newSettings));
        safeSetLocalStorage('sorella_products', JSON.stringify(newProducts));
        safeSetLocalStorage('sorella_categories', JSON.stringify(newCategories));
        safeSetLocalStorage('sorella_banners', JSON.stringify(newBanners));
        safeSetLocalStorage('sorella_coupons', JSON.stringify(newCoupons));
        safeSetLocalStorage('sorella_filters', JSON.stringify(newFilters));
      } catch (storageError) {
        console.warn("Could not save to localStorage (quota exceeded or disabled):", storageError);
      }

      if (user) {
        const wData = await getWishlist(user.uid);
        setWishlist(wData || []);
      }
      
      setApiStatus({
        mercadopago: !!sData?.mercadopago_access_token,
        whatsapp: !!sData?.whatsapp_number,
        gemini: !!(sData?.gemini_api_key || getApiKey())
      });
      setQuotaExceeded(false);
    } catch (err: any) {
      console.error("Error fetching data:", err);
      if (err.message && (err.message.includes('Quota') || err.message.includes('quota') || err.message.includes('429') || err.message.includes('403'))) {
        setQuotaExceeded(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    try {
      await saveProduct(editingProduct.id ? String(editingProduct.id) : null, editingProduct);
      setEditingProduct(null);
      fetchData();
      alert('Producto guardado con éxito');
    } catch (err) {
      console.error(err);
      alert('Error al guardar el producto. Verifica tus permisos.');
    }
  };

  const handleSaveCoupon = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingCoupon) return;
    try {
      await saveCoupon(editingCoupon.id || null, editingCoupon);
      setEditingCoupon(null);
      fetchData();
      alert('Cupón guardado con éxito');
    } catch (err) {
      console.error(err);
      alert('Error al guardar el cupón.');
    }
  };

  const handleSaveCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingCategory) {
      alert('No hay categoría para guardar');
      return;
    }
    try {
      console.log('Saving category:', editingCategory);
      await saveCategory(editingCategory.id ? String(editingCategory.id) : null, editingCategory);
      setEditingCategory(null);
      fetchData();
      alert('Categoría guardada con éxito');
    } catch (err) {
      console.error(err);
      alert('Error al guardar la categoría. Verifica tus permisos.');
    }
  };

  const handleSaveBanner = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingBanner) return;
    try {
      await saveBanner(editingBanner.id ? String(editingBanner.id) : null, editingBanner);
      setEditingBanner(null);
      fetchData();
      alert('Banner guardado con éxito');
    } catch (err) {
      console.error(err);
      alert('Error al guardar el banner. Verifica tus permisos.');
    }
  };

  const handleAiEdit = async () => {
    if (!aiPrompt) return;
    if (isExhausted) {
      alert(`Se ha alcanzado el límite diario de generaciones. Disponible en ${timeLeft}`);
      return;
    }
    
    const apiKey = getApiKey();
    if (!apiKey) {
      // If no key in environment, try to open the selector
      await checkAndOpenApiKey();
    }
    
    const finalApiKey = getApiKey();
    if (!finalApiKey) {
      alert("API Key no encontrada. Por favor, asegúrate de tener una llave configurada.");
      return;
    }

    setAiLoading(true);
    try {
      const genAI = new GoogleGenAI({ apiKey: finalApiKey });
      
      let imagePart = null;
      if (editingProduct?.image_url) {
        const resized = await urlToBase64(editingProduct.image_url);
        if (resized) {
          imagePart = { inlineData: { data: resized, mimeType: "image/jpeg" } };
        }
      }

      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [
            ...(imagePart ? [imagePart] : []),
            { text: aiPrompt }
          ]
        }
      });

      let imageUrl = null;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      
      if (imageUrl) {
        const compressedImage = await compressBase64Image(imageUrl);
        setEditingProduct({ ...editingProduct!, image_url: compressedImage });
      } else {
        alert("No se pudo generar la imagen. Intenta con otro prompt.");
      }
    } catch (err: any) {
      console.error(err);
      const errMsg = err.message?.toLowerCase() || '';
      if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('exhausted')) {
        setExhausted();
        alert(`Se ha alcanzado el límite diario de generaciones. Disponible en ${timeLeft || '24h'}`);
      } else {
        alert("Error al procesar la imagen con IA.");
      }
    } finally {
      setAiLoading(false);
    }
  };

  const handleCategoryAiEdit = async () => {
    if (!aiCategoryPrompt) return;
    
    const apiKey = getApiKey();
    if (!apiKey) {
      // If no key in environment, try to open the selector
      await checkAndOpenApiKey();
    }
    
    const finalApiKey = getApiKey();
    if (!finalApiKey) {
      alert("API Key no encontrada. Por favor, asegúrate de tener una llave configurada.");
      return;
    }

    setAiLoading(true);
    try {
      const genAI = new GoogleGenAI({ apiKey: finalApiKey });
      // Use gemini-2.5-flash-image by default as it works with free tier
      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [
            ...(editingCategory?.image_url && editingCategory.image_url.startsWith('data:image')
              ? [{ inlineData: { data: editingCategory.image_url.split(',')[1], mimeType: "image/png" } }]
              : []),
            { text: aiCategoryPrompt }
          ]
        }
      });

      let imageUrl = null;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      
      if (imageUrl) {
        const compressedImage = await compressBase64Image(imageUrl);
        setEditingCategory({ ...editingCategory!, image_url: compressedImage });
      } else {
        alert("No se pudo generar la imagen. Intenta con otro prompt.");
      }
    } catch (err) {
      console.error(err);
      alert("Error al procesar la imagen con IA.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAITranslate = async (type: 'product' | 'category') => {
    const finalApiKey = getApiKey();
    if (!finalApiKey) {
      alert("API Key no encontrada.");
      return;
    }

    setAiLoading(true);
    try {
      const genAI = new GoogleGenAI({ apiKey: finalApiKey });
      const source = type === 'product' ? editingProduct : editingCategory;
      if (!source) return;

      const prompt = `Traduce el siguiente nombre y descripción al inglés si están en español, o al español si están en inglés. Devuelve SOLO un objeto JSON con los campos "name" y "description".
      Nombre: ${source.name}
      Descripción: ${source.description}`;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json"
        }
      });

      const translated = JSON.parse(response.text || '{}');
      if (translated.name && translated.description) {
        if (type === 'product') {
          setEditingProduct({ ...editingProduct!, name: translated.name, description: translated.description });
        } else {
          setEditingCategory({ ...editingCategory!, name: translated.name, description: translated.description });
        }
      }
    } catch (err) {
      console.error(err);
      alert("Error al traducir con IA.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleUpdateSettings = async (newSettings: Partial<Settings>) => {
    try {
      console.log('App.tsx: Actualizando configuraciones:', newSettings);
      await saveSettings(newSettings);
      await fetchData();
      alert('Configuración actualizada correctamente');
    } catch (err) {
      console.error('App.tsx: Error al actualizar configuraciones:', err);
      alert('Error al guardar la configuración. Revisa la consola.');
    }
  };

  const allSizes = useMemo(() => {
    const sizes = new Set<string>();
    products.forEach(p => p.sizes?.forEach(s => sizes.add(s)));
    return Array.from(sizes).sort();
  }, [products]);

  const allColors = useMemo(() => {
    const colors = new Set<string>();
    products.forEach(p => p.colors?.forEach(c => colors.add(c)));
    return Array.from(colors).sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesCategory = categoryFilter === 'Todos' || p.category === categoryFilter;
      const matchesPrice = p.price >= priceRange[0] && p.price <= priceRange[1];
      const matchesSize = sizeFilter === 'Todos' || (p.sizes && p.sizes.includes(sizeFilter));
      const matchesColor = colorFilter === 'Todos' || (p.colors && p.colors.includes(colorFilter));
      
      let matchesDynamic = true;
      for (const [filterName, selectedOption] of Object.entries(selectedDynamicFilters)) {
        if (selectedOption !== 'Todos') {
          if (!p.filters || p.filters[filterName] !== selectedOption) {
            matchesDynamic = false;
            break;
          }
        }
      }

      return matchesCategory && matchesPrice && matchesSize && matchesColor && matchesDynamic;
    });
  }, [products, categoryFilter, priceRange, sizeFilter, colorFilter, selectedDynamicFilters]);

  if (loading) return <div className="h-screen flex items-center justify-center text-brand-peach animate-pulse">{language === 'es' ? 'Cargando Sorella...' : 'Loading Sorella...'}</div>;

  if (settings?.maintenance_mode && !isAdmin) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden" style={{ backgroundColor: settings.maintenance_bg_color || 'var(--bg-primary)' }}>
          {settings.maintenance_image && (
            <div 
              className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-500"
              style={{ 
                backgroundImage: `url(${settings.maintenance_image})`,
                filter: `blur(${settings.maintenance_blur || 0}px)`
              }}
            />
          )}
          <div className="relative z-10 flex flex-col items-center justify-center max-w-2xl w-full">
            <h1 
              className="text-4xl md:text-6xl font-bold mb-8 text-center tracking-tighter uppercase"
              style={{ color: settings.maintenance_text_color || 'var(--text-primary)' }}
            >
              {settings?.maintenance_message || (language === 'es' ? 'Estamos en mantenimiento' : 'We are under maintenance')}
            </h1>
            <div className="flex gap-4">
               <button 
                 onClick={() => setIsAuthOpen(true)} 
                 className="bg-brand-peach text-white px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg"
               >
                 {t.auth.login}
               </button>
               <button 
                 onClick={() => setLanguage(language === 'es' ? 'en' : 'es')} 
                 className="bg-[var(--bg-secondary)] text-[var(--text-primary)] px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg backdrop-blur-md bg-opacity-50"
               >
                 {language.toUpperCase()}
               </button>
            </div>
          </div>
        </div>
        
        <AuthModal 
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          t={t}
          isPendingAdmin={isPendingAdmin}
        />
        <UserProfileModal 
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          user={user}
          t={t}
          initialTab={profileTab}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {quotaExceeded && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2 z-[9999] relative">
          <Icons.AlertTriangle size={16} />
          <span>El sitio está funcionando en modo sin conexión (límite de cuota excedido). Mostrando datos guardados.</span>
          <button onClick={() => setQuotaExceeded(false)} className="ml-2 hover:opacity-70"><Icons.X size={14} /></button>
        </div>
      )}
      <AppCursor type={(settings?.cursor_type as 'default' | 'hanger') || 'default'} speed={(settings?.cursor_speed as 'slow' | 'medium' | 'fast') || 'slow'} />
      <header className="sticky top-0 w-full z-50">
        {['/catalogo', '/indumentaria', '/perfumes'].includes(location.pathname) && (
          <div className="fixed top-20 right-4 z-[100] lg:hidden">
            <button onClick={() => setIsMobileFilterOpen(true)} className="bg-brand-peach text-white p-4 rounded-full shadow-lg">
              <FilterIcon size={24} />
            </button>
          </div>
        )}
        <AnnouncementBar settings={settings} />
        <Navbar 
          language={language}
          setLanguage={setLanguage}
          theme={theme}
          setTheme={setTheme}
          t={t}
          user={user}
          cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)}
          onCartClick={() => setIsCartOpen(true)}
          onCategoryFilter={setCategoryFilter}
          onSizeFilter={setSizeFilter}
          onColorFilter={setColorFilter}
          onProfileClick={handleProfileClick}
          settings={settings}
          setIsAuthOpen={setIsAuthOpen}
          isAdmin={isAdmin}
          products={products}
        />
      </header>

      {/* Floating Filters for Mobile */}
      <AnimatePresence>
      </AnimatePresence>

      <div>
        <AuthModal 
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          t={t}
          isPendingAdmin={isPendingAdmin}
        />
        <UserProfileModal 
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          user={user}
          t={t}
          initialTab={profileTab}
        />

        <CartDrawer 
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        filters={filters}
        onUpdateQuantity={updateQuantity}
        onRemove={removeFromCart}
        onCheckout={handleCheckout}
        t={t}
      />

      <AnimatePresence>
        {isMobileFilterOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileFilterOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-md z-[150]"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="fixed inset-x-0 bottom-0 bg-white/80 dark:bg-brand-dark/80 backdrop-blur-2xl z-[160] rounded-t-[40px] p-8 max-h-[80vh] overflow-y-auto border-t border-white/50 dark:border-white/10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-bold uppercase tracking-tighter dark:text-white">{t.catalog.filters}</h3>
                <button onClick={() => setIsMobileFilterOpen(false)} className="p-2 bg-brand-peach/10 rounded-full text-brand-peach">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-8">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-brand-peach mb-4">Precio</h4>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setPriceSort('asc')}
                      className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${priceSort === 'asc' ? 'bg-brand-peach text-white' : 'bg-white dark:bg-white/10 border border-brand-peach/10 dark:text-white'}`}
                    >
                      Menor a Mayor
                    </button>
                    <button
                      onClick={() => setPriceSort('desc')}
                      className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${priceSort === 'desc' ? 'bg-brand-peach text-white' : 'bg-white dark:bg-white/10 border border-brand-peach/10 dark:text-white'}`}
                    >
                      Mayor a Menor
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-brand-peach mb-4">Descuentos</h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setDiscountFilter(!discountFilter)}
                      className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${discountFilter ? 'bg-brand-peach text-white' : 'bg-white dark:bg-white/10 border border-brand-peach/10 dark:text-white'}`}
                    >
                      Con Descuento
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-brand-peach mb-4">{t.catalog.priceRange}</h4>
                  <input 
                    type="range" 
                    min="0" 
                    max="200000" 
                    step="1000"
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([priceRange[0], parseInt(e.target.value)])}
                    className="w-full accent-brand-peach mb-2"
                  />
                  <div className="flex justify-between text-sm font-bold dark:text-white">
                    <span className="text-gray-400">$0</span>
                    <span className="text-brand-peach">${priceRange[1].toLocaleString()}</span>
                  </div>
                </div>

                {allSizes.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-brand-peach mb-4">{t.catalog.sizes}</h4>
                    <div className="flex flex-wrap gap-2">
                      {['Todos', ...allSizes].map(size => (
                        <button
                          key={size}
                          onClick={() => setSizeFilter(size)}
                          className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${sizeFilter === size ? 'bg-brand-peach text-white' : 'bg-white dark:bg-white/10 border border-brand-peach/10 dark:text-white'}`}
                        >
                          {size === 'Todos' ? t.catalog.all : size}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {allColors.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-brand-peach mb-4">{t.catalog.colors}</h4>
                    <div className="flex flex-wrap gap-2">
                      {['Todos', ...allColors].map(color => (
                        <button
                          key={color}
                          onClick={() => setColorFilter(color)}
                          className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${colorFilter === color ? 'bg-brand-peach text-white' : 'bg-white dark:bg-white/10 border border-brand-peach/10 dark:text-white'}`}
                        >
                          {color === 'Todos' ? t.catalog.all : color}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {filters.map(filter => (
                  <div key={filter.id}>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-brand-peach mb-4">{filter.name}</h4>
                    <div className="flex flex-wrap gap-2">
                      {['Todos', ...filter.options].map(option => (
                        <button
                          key={option}
                          onClick={() => setSelectedDynamicFilters(prev => ({ ...prev, [filter.name]: option }))}
                          className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${(selectedDynamicFilters[filter.name] || 'Todos') === option ? 'bg-brand-peach text-white' : 'bg-white dark:bg-white/10 border border-brand-peach/10 dark:text-white'}`}
                        >
                          {option === 'Todos' ? t.catalog.all : option}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <button 
                  onClick={() => setIsMobileFilterOpen(false)}
                  className="w-full bg-brand-dark text-white py-4 rounded-2xl font-bold uppercase tracking-widest mt-4"
                >
                  {t.admin.settings.save}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <Routes>
        <Route path="/" element={
          <>
            <HeroBanner 
              banners={banners} 
              t={t} 
              onCategoryClick={(cat) => {
                setCategoryFilter(cat);
                navigate('/catalogo');
              }} 
            />

            <OffersCarousel 
              products={products} 
              t={t} 
              onAddToCart={addToCart} 
              onWishlistToggle={toggleWishlist}
              wishlist={wishlist}
            />

            {/* Lanzamientos Section */}
            <section className="py-24 px-6 max-w-7xl mx-auto">
              <div className="flex justify-between items-end mb-12">
                <div>
                  <span className="text-brand-peach font-bold uppercase tracking-widest text-xs mb-2 block">{t.home.lanzamientos}</span>
                  <h2 className="text-4xl md:text-6xl font-bold tracking-tighter uppercase">{t.home.lanzamientos}</h2>
                </div>
                <button 
                  onClick={() => navigate('/catalogo')}
                  className="text-brand-peach font-bold flex items-center gap-2 hover:gap-4 transition-all"
                >
                  {t.catalog.all} <ArrowRight size={20} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {products
                  .filter(p => {
                    if (settings?.lanzamientos_category) {
                      const productCats = p.categories || [p.category];
                      return productCats.includes(settings.lanzamientos_category);
                    }
                    return true;
                  })
                  .slice(0, 8)
                  .map(product => (
                    <ProductCard 
                      key={product.id} 
                      product={product} 
                      t={t} 
                      onAddToCart={addToCart}
                      onWishlistToggle={toggleWishlist}
                      isInWishlist={wishlist.some(item => String(item.productId) === String(product.id))}
                    />
                  ))}
              </div>
            </section>

            {/* Featured Category Section */}
            {settings?.featured_category && (
              <FeaturedCategory 
                category={settings.featured_category}
                products={products}
                layout={settings.featured_layout || 'grid'}
                t={t}
                onAddToCart={addToCart}
                onWishlistToggle={toggleWishlist}
                wishlist={wishlist}
              />
            )}

            {/* Categories Visual Section */}
            <section className="py-24 px-6 max-w-7xl mx-auto">
              <div className="flex justify-between items-end mb-12">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-[0.3em] text-brand-peach mb-4">{t.categories.subtitle}</h2>
                  <h3 className="text-4xl md:text-6xl font-bold tracking-tighter">{t.categories.title}</h3>
                </div>
                <p className="hidden md:block text-gray-400 max-w-xs text-right">
                  {t.categories.description}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {categories.map(cat => (
                  <CategoryCard 
                    key={cat.id} 
                    category={cat} 
                    onClick={() => {
                      setCategoryFilter(cat.name);
                      navigate('/catalogo');
                    }} 
                  />
                ))}
              </div>
            </section>

            {/* Simple Home Catalog */}
            <section className="py-24 px-6 max-w-7xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold tracking-tighter uppercase mb-4">{t.catalog.title}</h2>
                <div className="w-20 h-1 bg-brand-peach mx-auto"></div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {products.slice(0, 8).map(product => (
                  <ProductCard 
                    key={product.id} 
                    product={product} 
                    t={t} 
                    onAddToCart={addToCart}
                    onWishlistToggle={toggleWishlist}
                    isInWishlist={wishlist.some(item => String(item.productId) === String(product.id))}
                  />
                ))}
              </div>
              <div className="text-center mt-12">
                <button 
                  onClick={() => {
                    navigate('/catalogo');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="bg-brand-dark text-white px-10 py-4 rounded-full font-bold uppercase tracking-widest hover:bg-brand-peach transition-colors"
                >
                  Explorar Catálogo Completo
                </button>
              </div>
            </section>
          </>
        } />

        <Route path="/catalogo" element={
          <CatalogPage 
            products={products}
            categories={categories}
            onAddToCart={addToCart}
            onTryOn={() => {}}
            t={t}
            selectedCategory={categoryFilter}
            onCategoryChange={setCategoryFilter}
            selectedSize={sizeFilter}
            onSizeChange={setSizeFilter}
            selectedColor={colorFilter}
            onColorChange={setColorFilter}
            selectedPriceSort={priceSort}
            onPriceSortChange={setPriceSort}
            selectedDiscount={discountFilter}
            onDiscountChange={setDiscountFilter}
            title={categoryFilter !== 'Todos' ? categoryFilter : t.nav.catalog}
            priceRange={priceRange}
            onPriceRangeChange={setPriceRange}
            onOpenFilters={() => setIsMobileFilterOpen(true)}
            filters={filters}
            selectedDynamicFilters={selectedDynamicFilters}
            onDynamicFilterChange={(name, val) => setSelectedDynamicFilters(prev => ({ ...prev, [name]: val }))}
            onWishlistToggle={toggleWishlist}
            wishlist={wishlist}
          />
        } />

        <Route path="/indumentaria" element={
          <CatalogPage 
            products={products.filter(p => p.category === 'Indumentaria' || p.category === 'Ropa')}
            categories={categories.filter(c => c.name === 'Indumentaria' || c.name === 'Ropa')}
            onAddToCart={addToCart}
            onTryOn={() => {}}
            t={t}
            selectedCategory={categoryFilter === 'Perfumes' ? 'Todos' : categoryFilter}
            onCategoryChange={setCategoryFilter}
            selectedSize={sizeFilter}
            onSizeChange={setSizeFilter}
            selectedColor={colorFilter}
            onColorChange={setColorFilter}
            selectedPriceSort={priceSort}
            onPriceSortChange={setPriceSort}
            selectedDiscount={discountFilter}
            onDiscountChange={setDiscountFilter}
            title={t.nav.clothing}
            priceRange={priceRange}
            onPriceRangeChange={setPriceRange}
            onOpenFilters={() => setIsMobileFilterOpen(true)}
            filters={filters}
            selectedDynamicFilters={selectedDynamicFilters}
            onDynamicFilterChange={(name, val) => setSelectedDynamicFilters(prev => ({ ...prev, [name]: val }))}
            onWishlistToggle={toggleWishlist}
            wishlist={wishlist}
          />
        } />

        <Route path="/perfumes" element={
          <CatalogPage 
            products={products.filter(p => p.category === 'Perfumes')}
            categories={categories.filter(c => c.name === 'Perfumes')}
            onAddToCart={addToCart}
            onTryOn={() => {}}
            t={t}
            selectedCategory={categoryFilter === 'Indumentaria' || categoryFilter === 'Ropa' ? 'Todos' : categoryFilter}
            onCategoryChange={setCategoryFilter}
            selectedSize={sizeFilter}
            onSizeChange={setSizeFilter}
            selectedColor={colorFilter}
            onColorChange={setColorFilter}
            selectedPriceSort={priceSort}
            onPriceSortChange={setPriceSort}
            selectedDiscount={discountFilter}
            onDiscountChange={setDiscountFilter}
            title={t.nav.perfumes}
            priceRange={priceRange}
            onPriceRangeChange={setPriceRange}
            onOpenFilters={() => setIsMobileFilterOpen(true)}
            filters={filters}
            selectedDynamicFilters={selectedDynamicFilters}
            onDynamicFilterChange={(name, val) => setSelectedDynamicFilters(prev => ({ ...prev, [name]: val }))}
            onWishlistToggle={toggleWishlist}
            wishlist={wishlist}
          />
        } />

      <Route path="/admin" element={
        <>
          <div className="pt-32 min-h-screen bg-[var(--bg-primary)] p-6 transition-colors">
            <div className="max-w-7xl mx-auto bg-[var(--bg-secondary)] rounded-[40px] shadow-lg overflow-hidden flex flex-col border border-[var(--border-color)]">
            <div className="p-8 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-secondary)]">
              <h2 className="text-2xl font-bold text-[var(--text-primary)]">{t.admin.title}</h2>
              {user && isAdmin && (
                <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                  <span>{t.admin.loggedAs} <span className="font-bold text-brand-peach">{user.displayName || user.email}</span></span>
                  {user.photoURL && <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-[var(--border-color)]" />}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              {!isAdmin ? (
                <AdminAuth t={t} settings={settings} onAdminAuth={() => setIsAdmin(true)} />
              ) : (
                <div className="space-y-12">
                  {/* Admin Tabs */}
                  <div className="flex items-center gap-4 border-b border-[var(--border-color)] pb-6 overflow-x-auto">
                    <div className="flex gap-3">
                      {[
                        { id: 'products', label: t.admin.tabs.products, icon: ShoppingBag },
                        { id: 'categories', label: t.admin.tabs.categories, icon: List },
                        { id: 'banners', label: t.admin.tabs.banners, icon: Layout },
                        { id: 'sales', label: t.admin.tabs.sales, icon: Clock },
                        { id: 'users', label: t.admin.tabs.users, icon: Users },
                        { id: 'marketing', label: t.admin.tabs.marketing, icon: MessageSquare },
                        { id: 'coupons', label: t.admin.tabs.coupons, icon: Tag },
                        { id: 'filters', label: 'Filtros', icon: FilterIcon },
                        { id: 'emails', label: t.admin.tabs.emails, icon: Mail },
                        ...(user?.email?.toLowerCase() === 'dgmvolpi@gmail.com' ? [{ id: 'requests', label: t.admin.tabs.requests, icon: MessageSquare }] : []),
                        { id: 'settings', label: t.admin.tabs.settings, icon: SettingsIcon },
                      ].map(tab => (
                        <button 
                          key={tab.id}
                          onClick={() => setAdminTab(tab.id as any)}
                          className={`flex items-center gap-2 px-6 py-3 rounded-2xl transition-all whitespace-nowrap font-bold text-sm ${
                            adminTab === tab.id 
                              ? 'bg-brand-peach text-white shadow-xl shadow-brand-peach/20 scale-105' 
                              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] border border-transparent hover:border-[var(--border-color)]'
                          }`}
                        >
                          <tab.icon size={18} /> {tab.label}
                        </button>
                      ))}
                    </div>
                    <button 
                      onClick={async () => {
                        await logout();
                        setIsAdmin(false);
                        window.location.href = '/';
                      }}
                      className="ml-auto flex items-center gap-2 px-6 py-3 rounded-2xl bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all font-bold text-sm whitespace-nowrap border border-red-500/20"
                    >
                      <LogOut size={18} /> {t.admin.logout}
                    </button>
                  </div>

                  {adminTab === 'requests' && user?.email?.toLowerCase() === 'dgmvolpi@gmail.com' && (
                    <div className="space-y-6">
                      <div className="flex justify-between items-center">
                        <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t.admin.requests.title}</h3>
                        <button 
                          onClick={() => getAdminRequests().then(setAdminRequests)}
                          className="text-brand-peach font-bold text-sm flex items-center gap-2"
                        >
                          <Zap size={16} /> {t.admin.requests.update}
                        </button>
                      </div>
                      
                      <div className="bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden shadow-sm">
                        <table className="w-full text-left">
                          <thead className="bg-[var(--bg-secondary)] text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                            <tr>
                              <th className="px-6 py-4">{t.admin.requests.email}</th>
                              <th className="px-6 py-4">{t.admin.requests.status}</th>
                              <th className="px-6 py-4">{t.admin.requests.date}</th>
                              <th className="px-6 py-4 text-right">{t.admin.requests.actions}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border-color)]">
                            {adminRequests.map(req => (
                              <tr key={req.id} className="hover:bg-[var(--bg-secondary)]/50 transition-colors">
                                <td className="px-6 py-4 font-medium text-[var(--text-primary)]">{req.email}</td>
                                <td className="px-6 py-4">
                                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                                    req.status === 'approved' ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400' :
                                    req.status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' :
                                    req.status === 'completed' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                                    'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400'
                                  }`}>
                                    {req.status === 'pending' ? t.admin.requests.pending : 
                                     req.status === 'approved' ? t.admin.requests.approved : 
                                     req.status === 'completed' ? t.admin.requests.completed : t.admin.requests.rejected}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-[var(--text-secondary)]">
                                  {req.createdAt?.toDate ? req.createdAt.toDate().toLocaleDateString() : 'Reciente'}
                                </td>
                                <td className="px-6 py-4 text-right">
                                  {req.status === 'pending' && (
                                    <div className="flex justify-end gap-2">
                                      <button 
                                        onClick={async () => {
                                          await updateAdminRequestStatus(req.id, 'approved');
                                          getAdminRequests().then(setAdminRequests);
                                        }}
                                        className="p-2 bg-green-500/10 text-green-500 rounded-xl hover:bg-green-500/20 transition-colors"
                                        title={t.admin.requests.approve}
                                      >
                                        <Check size={16} />
                                      </button>
                                      <button 
                                        onClick={async () => {
                                          await updateAdminRequestStatus(req.id, 'rejected');
                                          getAdminRequests().then(setAdminRequests);
                                        }}
                                        className="p-2 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 transition-colors"
                                        title={t.admin.requests.reject}
                                      >
                                        <X size={16} />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {adminRequests.length === 0 && (
                              <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-[var(--text-secondary)] italic">{t.admin.requests.noRequests}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {adminTab === 'users' && (
                      <div className="space-y-6">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <h3 className="text-2xl font-bold text-[var(--text-primary)]">Gestión de Usuarios</h3>
                          <div className="flex flex-wrap gap-3 w-full md:w-auto">
                            <button 
                              onClick={() => {
                                const usersToExport = selectedUserIds.length > 0 
                                  ? users.filter(u => selectedUserIds.includes(u.id))
                                  : users;

                                const data = usersToExport.map(u => ({
                                  'Email': u.email,
                                  'Nombre': u.displayName || 'N/A',
                                  'Rol': u.role || 'user',
                                  'Estado': u.approved ? 'Aprobado' : 'Pendiente',
                                  'Teléfono': u.phone || '',
                                  'DNI': u.dni || '',
                                  'Dirección': u.address || '',
                                  'Ciudad': u.city || '',
                                  'Fecha Registro': u.createdAt?.seconds ? new Date(u.createdAt.seconds * 1000).toLocaleString() : 'N/A'
                                }));

                                const worksheet = XLSX.utils.json_to_sheet(data);
                                const workbook = XLSX.utils.book_new();
                                XLSX.utils.book_append_sheet(workbook, worksheet, "Usuarios");
                                XLSX.writeFile(workbook, `Usuarios_Sorella_${new Date().toISOString().split('T')[0]}.xlsx`);
                              }}
                              className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-2xl text-sm font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-600/20"
                            >
                              <Download size={18} /> Exportar Excel {selectedUserIds.length > 0 ? `(${selectedUserIds.length})` : '(Todos)'}
                            </button>
                            <button 
                              onClick={async () => {
                                const email = prompt(t.admin.users.promotePrompt);
                                if (email) {
                                  const userToPromote = users.find(u => u.email.toLowerCase() === email.toLowerCase());
                                  if (userToPromote) {
                                    await updateUserRole(userToPromote.id, 'admin', true);
                                    getUsers().then(setUsers);
                                    alert(t.admin.users.promoteSuccess);
                                  } else {
                                    alert(t.admin.users.promoteNotFound);
                                  }
                                }
                              }}
                              className="flex items-center gap-2 px-6 py-3 bg-brand-peach text-white rounded-2xl text-sm font-bold hover:bg-brand-dark transition-all shadow-lg shadow-brand-peach/20"
                            >
                              <Plus size={18} /> {t.admin.users.promote}
                            </button>
                            <div className="relative w-full md:w-64">
                              <Icons.Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={18} />
                              <input 
                                type="text"
                                placeholder={t.admin.users.searchPlaceholder}
                                className="w-full pl-12 pr-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl text-sm outline-none focus:ring-2 focus:ring-brand-peach/20 text-[var(--text-primary)]"
                                onChange={(e) => {
                                  const term = e.target.value.toLowerCase();
                                  const rows = document.querySelectorAll('.user-row');
                                  rows.forEach((row: any) => {
                                    const text = row.innerText.toLowerCase();
                                    row.style.display = text.includes(term) ? '' : 'none';
                                  });
                                }}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="bg-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] overflow-hidden shadow-sm">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                                  <th className="px-6 py-4 w-10">
                                    <input 
                                      type="checkbox"
                                      className="rounded border-[var(--border-color)] text-brand-peach focus:ring-brand-peach"
                                      checked={selectedUserIds.length === users.length && users.length > 0}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedUserIds(users.map(u => u.id));
                                        } else {
                                          setSelectedUserIds([]);
                                        }
                                      }}
                                    />
                                  </th>
                                  <th className="px-6 py-4 text-sm font-semibold text-[var(--text-secondary)]">{t.admin.users.email}</th>
                                  <th className="px-6 py-4 text-sm font-semibold text-[var(--text-secondary)]">{t.admin.users.name}</th>
                                  <th className="px-6 py-4 text-sm font-semibold text-[var(--text-secondary)]">{t.admin.users.phone}</th>
                                  <th className="px-6 py-4 text-sm font-semibold text-[var(--text-secondary)]">{t.admin.users.role}</th>
                                  <th className="px-6 py-4 text-sm font-semibold text-[var(--text-secondary)]">{t.admin.users.status}</th>
                                  <th className="px-6 py-4 text-sm font-semibold text-[var(--text-secondary)]">{t.admin.users.actions}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border-color)]">
                                {users.map(u => (
                                  <tr key={u.id} className="user-row hover:bg-[var(--bg-secondary)]/50 transition-colors">
                                    <td className="px-6 py-4">
                                      <input 
                                        type="checkbox"
                                        className="rounded border-[var(--border-color)] text-brand-peach focus:ring-brand-peach"
                                        checked={selectedUserIds.includes(u.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedUserIds([...selectedUserIds, u.id]);
                                          } else {
                                            setSelectedUserIds(selectedUserIds.filter(id => id !== u.id));
                                          }
                                        }}
                                      />
                                    </td>
                                    <td className="px-6 py-4 text-sm text-[var(--text-primary)]">{u.email}</td>
                                    <td className="px-6 py-4 text-sm text-[var(--text-secondary)]">{u.displayName || 'N/A'}</td>
                                    <td className="px-6 py-4 text-sm text-[var(--text-secondary)] font-mono">{u.phone || '-'}</td>
                                    <td className="px-6 py-4 text-sm">
                                      <select 
                                        value={u.role || 'user'} 
                                        onChange={async (e) => {
                                          await updateUserRole(u.id, e.target.value, u.approved || false);
                                          getUsers().then(setUsers);
                                        }}
                                        className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-brand-peach/20 text-[var(--text-primary)]"
                                      >
                                        <option value="user" className="bg-[var(--bg-primary)]">{t.admin.users.user}</option>
                                        <option value="admin" className="bg-[var(--bg-primary)]">{t.admin.users.admin}</option>
                                      </select>
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${u.approved ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' : 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'}`}>
                                        {u.approved ? t.admin.users.approved : t.admin.users.pending}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                      <button 
                                        onClick={async () => {
                                          await updateUserRole(u.id, u.role || 'user', !u.approved);
                                          getUsers().then(setUsers);
                                        }}
                                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${u.approved ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-green-500/10 text-green-500 hover:bg-green-500/20'}`}
                                      >
                                        {u.approved ? t.admin.users.revoke : t.admin.users.approve}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                    {adminTab === 'marketing' && (
                      <div className="space-y-8">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                          <div>
                            <h3 className="text-3xl font-bold text-[var(--text-primary)] tracking-tight">{t.admin.marketing.title}</h3>
                            <p className="text-[var(--text-secondary)] mt-1">Gestiona tus contactos y envía mensajes masivos.</p>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            <button 
                              onClick={() => {
                                const data = marketingNumbers.map(n => ({
                                  'Nombre': n.name,
                                  'Telefono': n.number,
                                  'Origen': n.source
                                }));
                                const worksheet = XLSX.utils.json_to_sheet(data);
                                const workbook = XLSX.utils.book_new();
                                XLSX.utils.book_append_sheet(workbook, worksheet, "Contactos");
                                XLSX.writeFile(workbook, `Contactos_WhatsApp_${new Date().toISOString().split('T')[0]}.xlsx`);
                              }}
                              className="flex items-center gap-2 px-6 py-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-2xl text-sm font-bold hover:bg-[var(--bg-secondary)] transition-all"
                            >
                              <Download size={18} /> Descargar Excel
                            </button>
                            <label className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-2xl text-sm font-bold hover:bg-green-700 transition-all cursor-pointer shadow-lg shadow-green-600/20">
                              <Upload size={18} /> Subir Excel
                              <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleMarketingExcelUpload} />
                            </label>
                            <button 
                              onClick={() => {
                                const num = prompt(t.admin.marketing.number);
                                const name = prompt(t.admin.marketing.name);
                                if (num) {
                                  const clean = num.replace(/\D/g, '');
                                  setMarketingNumbers(prev => [...prev, { number: clean, name: name || 'Manual', source: 'Manual' }]);
                                }
                              }}
                              className="flex items-center gap-2 px-6 py-3 bg-brand-peach text-white rounded-2xl text-sm font-bold hover:bg-brand-dark transition-all shadow-lg shadow-brand-peach/20"
                            >
                              <Plus size={18} /> {t.admin.marketing.addNumber}
                            </button>
                          </div>
                        </div>

                        <div className="grid lg:grid-cols-3 gap-8">
                          {/* Contact List */}
                          <div className="lg:col-span-2 space-y-4">
                            <div className="bg-[var(--bg-primary)] rounded-[32px] border border-[var(--border-color)] overflow-hidden">
                              <div className="p-6 border-b border-[var(--border-color)] flex justify-between items-center">
                                <h4 className="font-bold text-[var(--text-primary)]">{t.admin.marketing.contactsList.replace('{count}', marketingNumbers.length.toString())}</h4>
                                <div className="flex items-center gap-2">
                                  <input 
                                    type="checkbox"
                                    checked={selectedMarketingNumbers.length === marketingNumbers.length && marketingNumbers.length > 0}
                                    onChange={(e) => {
                                      if (e.target.checked) setSelectedMarketingNumbers(marketingNumbers.map(n => n.number));
                                      else setSelectedMarketingNumbers([]);
                                    }}
                                    className="rounded border-[var(--border-color)] text-brand-peach focus:ring-brand-peach"
                                  />
                                  <span className="text-xs font-bold text-[var(--text-secondary)] uppercase">{t.admin.marketing.selectAll}</span>
                                </div>
                              </div>
                              <div className="max-h-[500px] overflow-y-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead className="sticky top-0 bg-[var(--bg-primary)] z-10">
                                    <tr className="border-b border-[var(--border-color)]">
                                      <th className="px-6 py-4 w-10"></th>
                                      <th className="px-6 py-4 text-[10px] font-bold uppercase text-[var(--text-secondary)]">{t.admin.marketing.name}</th>
                                      <th className="px-6 py-4 text-[10px] font-bold uppercase text-[var(--text-secondary)]">{t.admin.marketing.number}</th>
                                      <th className="px-6 py-4 text-[10px] font-bold uppercase text-[var(--text-secondary)]">{t.admin.marketing.source}</th>
                                      <th className="px-6 py-4 w-10"></th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[var(--border-color)]">
                                    {marketingNumbers.map((n, idx) => (
                                      <tr key={idx} className="hover:bg-[var(--bg-secondary)]/50 transition-colors group">
                                        <td className="px-6 py-4">
                                          <input 
                                            type="checkbox"
                                            checked={selectedMarketingNumbers.includes(n.number)}
                                            onChange={(e) => {
                                              if (e.target.checked) setSelectedMarketingNumbers([...selectedMarketingNumbers, n.number]);
                                              else setSelectedMarketingNumbers(selectedMarketingNumbers.filter(id => id !== n.number));
                                            }}
                                            className="rounded border-[var(--border-color)] text-brand-peach focus:ring-brand-peach"
                                          />
                                        </td>
                                        <td className="px-6 py-4 text-sm font-medium text-[var(--text-primary)]">{n.name}</td>
                                        <td className="px-6 py-4 text-sm font-mono text-[var(--text-secondary)]">{n.number}</td>
                                        <td className="px-6 py-4">
                                          <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${
                                            n.source === 'Registro' ? 'bg-blue-500/10 text-blue-500' :
                                            n.source === 'Pedido' ? 'bg-purple-500/10 text-purple-500' :
                                            n.source === 'Excel' ? 'bg-green-500/10 text-green-500' :
                                            'bg-gray-500/10 text-gray-500'
                                          }`}>
                                            {n.source}
                                          </span>
                                        </td>
                                        <td className="px-6 py-4">
                                          <button 
                                            onClick={() => setMarketingNumbers(prev => prev.filter((_, i) => i !== idx))}
                                            className="p-2 text-red-500 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/10 rounded-lg"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                    {marketingNumbers.length === 0 && (
                                      <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-[var(--text-secondary)] italic">{t.admin.marketing.noContacts}</td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>

                          {/* Message Composer */}
                          <div className="space-y-6">
                            <div className="bg-[var(--bg-primary)] rounded-[32px] border border-[var(--border-color)] p-8 shadow-sm sticky top-32">
                              <h4 className="text-xl font-bold text-[var(--text-primary)] mb-6 flex items-center gap-2">
                                <Send size={20} className="text-brand-peach" /> {t.admin.marketing.composeMessage}
                              </h4>
                              
                              <div className="space-y-6">
                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.marketing.customMessage}</label>
                                  <textarea 
                                    value={marketingMessage}
                                    onChange={e => setMarketingMessage(e.target.value)}
                                    placeholder={t.admin.marketing.messagePlaceholder}
                                    className="w-full h-40 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-brand-peach/20 text-[var(--text-primary)] resize-none"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.marketing.attachFile}</label>
                                  <div className="flex items-center gap-3">
                                    <label className="flex-1 flex items-center justify-center gap-2 p-4 border-2 border-dashed border-[var(--border-color)] rounded-2xl cursor-pointer hover:border-brand-peach transition-all group">
                                      <Paperclip size={18} className="text-[var(--text-secondary)] group-hover:text-brand-peach" />
                                      <span className="text-sm text-[var(--text-secondary)] group-hover:text-brand-peach">
                                        {marketingFile ? marketingFile.name : t.admin.marketing.selectFile}
                                      </span>
                                      <input 
                                        type="file" 
                                        accept="image/*, .pdf" 
                                        className="hidden" 
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            const reader = new FileReader();
                                            reader.onload = (evt) => {
                                              setMarketingFile({
                                                name: file.name,
                                                data: evt.target?.result as string,
                                                type: file.type
                                              });
                                            };
                                            reader.readAsDataURL(file);
                                          }
                                        }}
                                      />
                                    </label>
                                    {marketingFile && (
                                      <button 
                                        onClick={() => setMarketingFile(null)}
                                        className="p-4 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-500/20 transition-all"
                                      >
                                        <X size={18} />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {marketingLoading && (
                                  <div className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-bold uppercase text-[var(--text-secondary)]">
                                      <span>{t.admin.marketing.sending}</span>
                                      <span>{marketingProgress}%</span>
                                    </div>
                                    <div className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                                      <motion.div 
                                        className="h-full bg-brand-peach"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${marketingProgress}%` }}
                                      />
                                    </div>
                                  </div>
                                )}

                                <button 
                                  onClick={handleSendMassMessages}
                                  disabled={marketingLoading || marketingNumbers.length === 0}
                                  className="w-full py-4 bg-brand-peach text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-brand-dark transition-all shadow-lg shadow-brand-peach/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {marketingLoading ? t.admin.marketing.sending : (
                                    <>
                                      <Send size={18} /> 
                                      {t.admin.marketing.send.replace('{count}', (selectedMarketingNumbers.length > 0 ? selectedMarketingNumbers.length : marketingNumbers.length).toString())}
                                    </>
                                  )}
                                </button>
                                
                                <p className="text-[10px] text-[var(--text-secondary)] text-center italic">
                                  {t.admin.marketing.whatsappNote}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {adminTab === 'coupons' && (
                      <div className="space-y-6">
                        <div className="flex justify-between items-center">
                          <h3 className="text-2xl font-bold text-[var(--text-primary)]">{t.admin.coupons.title}</h3>
                          <button 
                            onClick={() => setEditingCoupon({
                              code: '',
                              discount_percentage: 0,
                              valid_from: new Date().toISOString().split('T')[0],
                              valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                              usage_count: 0,
                              active: true
                            })}
                            className="bg-brand-peach text-white px-6 py-3 rounded-2xl flex items-center gap-2 hover:opacity-90 transition-all font-bold text-sm shadow-lg shadow-brand-peach/20"
                          >
                            <Plus size={18} /> {t.admin.coupons.new}
                          </button>
                        </div>

                        <div className="grid gap-6">
                          {coupons.map(coupon => (
                            <div key={coupon.id} className="bg-[var(--bg-primary)] p-6 rounded-3xl border border-[var(--border-color)] flex items-center justify-between shadow-sm hover:shadow-md transition-all">
                              <div className="flex items-center gap-6">
                                <div className="w-16 h-16 bg-brand-peach/10 rounded-2xl flex items-center justify-center text-brand-peach">
                                  <Tag size={32} />
                                </div>
                                <div>
                                  <div className="flex items-center gap-3 mb-1">
                                    <h4 className="text-xl font-bold text-[var(--text-primary)]">{coupon.code}</h4>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${coupon.active ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                      {coupon.active ? t.admin.coupons.active : t.admin.coupons.inactive}
                                    </span>
                                  </div>
                                  <p className="text-sm text-[var(--text-secondary)]">
                                    {coupon.discount_percentage}% {t.admin.coupons.off} • {t.admin.coupons.expires}: {new Date(coupon.valid_until).toLocaleDateString()}
                                  </p>
                                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                                    {t.admin.coupons.uses}: {coupon.usage_count} {coupon.usage_limit ? `/ ${coupon.usage_limit}` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => setEditingCoupon(coupon)}
                                  className="p-3 bg-blue-500/10 text-blue-500 rounded-2xl hover:bg-blue-500/20 transition-colors"
                                >
                                  <Edit size={18} />
                                </button>
                                <button 
                                  onClick={async () => {
                                    if (confirm(t.admin.coupons.deleteConfirm)) {
                                      await deleteCoupon(coupon.id!);
                                      fetchData();
                                    }
                                  }}
                                  className="p-3 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-500/20 transition-colors"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </div>
                          ))}
                          {coupons.length === 0 && (
                            <div className="text-center py-20 bg-[var(--bg-primary)] rounded-[40px] border border-dashed border-[var(--border-color)]">
                              <Tag size={48} className="mx-auto text-[var(--text-secondary)] opacity-20 mb-4" />
                              <p className="text-[var(--text-secondary)] italic">{t.admin.coupons.noCoupons}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {adminTab === 'emails' && (
                      <div className="space-y-8">
                        <div className="grid md:grid-cols-2 gap-8">
                          <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><Mail size={20} /> {t.admin.emails.title}</h3>
                            <div className="space-y-6">
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.emails.smtpUser}</label>
                                <input 
                                  type="email"
                                  placeholder="ejemplo@gmail.com"
                                  value={settings?.smtp_user || ''}
                                  onChange={e => setSettings(settings ? {...settings, smtp_user: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                                <p className="text-[10px] text-[var(--text-secondary)] mt-1">{t.admin.emails.smtpHelp}</p>
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.emails.smtpPass}</label>
                                <input 
                                  type="password"
                                  placeholder="••••••••••••••••"
                                  value={settings?.smtp_pass || ''}
                                  onChange={e => setSettings(settings ? {...settings, smtp_pass: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.emails.whatsappLink}</label>
                                <input 
                                  placeholder="https://wa.me/54911..."
                                  value={settings?.whatsapp_link || ''}
                                  onChange={e => setSettings(settings ? {...settings, whatsapp_link: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                                <p className="text-[10px] text-[var(--text-secondary)] mt-1">{t.admin.emails.whatsappHelp}</p>
                              </div>
                              <button 
                                onClick={() => handleUpdateSettings({ 
                                  smtp_user: settings?.smtp_user,
                                  smtp_pass: settings?.smtp_pass,
                                  whatsapp_link: settings?.whatsapp_link
                                })}
                                className="bg-brand-peach text-white py-3 px-8 rounded-full text-sm font-bold hover:opacity-90 transition-colors"
                              >
                                {t.admin.emails.save}
                              </button>
                            </div>
                          </div>

                          <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><Send size={20} /> {t.admin.emails.testTitle}</h3>
                            <div className="space-y-6">
                              <p className="text-sm text-[var(--text-secondary)]">
                                {t.admin.emails.testHelp}
                              </p>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.emails.testEmail}</label>
                                <input 
                                  type="email"
                                  placeholder={t.admin.emails.testPlaceholder}
                                  id="test-email-input"
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <button 
                                onClick={async () => {
                                  const email = (document.getElementById('test-email-input') as HTMLInputElement).value;
                                  if (!email) {
                                    alert(t.admin.emails.testEnterEmail);
                                    return;
                                  }
                                  try {
                                    const res = await fetch('/api/admin/test-email', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ email })
                                    });
                                    const data = await res.json();
                                    if (res.ok) {
                                      alert(t.admin.emails.testSuccess);
                                    } else {
                                      alert(`Error: ${data.error}`);
                                    }
                                  } catch (e) {
                                    alert(t.admin.emails.testServerError);
                                  }
                                }}
                                className="bg-[var(--bg-secondary)] text-[var(--text-primary)] py-3 px-8 rounded-full text-sm font-bold hover:bg-[var(--bg-secondary)]/80 transition-colors border border-[var(--border-color)]"
                              >
                                {t.admin.emails.test}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {adminTab === 'settings' && (
                      <div className="space-y-8">
                        <div className="grid md:grid-cols-3 gap-8">
                          <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                            <div className="flex justify-between items-center mb-6">
                              <h3 className="text-xl font-bold flex items-center gap-2 text-[var(--text-primary)]"><Phone size={20} /> {t.admin.settings.whatsapp.title}</h3>
                              <div className={`w-3 h-3 rounded-full ${apiStatus.whatsapp ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`} />
                            </div>
                            <div className="space-y-4">
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.whatsapp.number}</label>
                                <input 
                                  placeholder={t.admin.settings.whatsapp.placeholder}
                                  value={settings?.whatsapp_number || ''}
                                  onChange={e => setSettings(settings ? {...settings, whatsapp_number: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.security.masterKey}</label>
                                <input 
                                  type="password"
                                  placeholder={t.admin.settings.security.masterKeyPlaceholder}
                                  value={settings?.admin_password || ''}
                                  onChange={e => setSettings(settings ? {...settings, admin_password: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.security.adminEmail}</label>
                                <input 
                                  type="email"
                                  placeholder={t.admin.settings.security.adminEmailPlaceholder}
                                  value={settings?.admin_email || ''}
                                  onChange={e => setSettings(settings ? {...settings, admin_email: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <button 
                                onClick={() => handleUpdateSettings({ 
                                  whatsapp_number: settings?.whatsapp_number,
                                  admin_password: settings?.admin_password,
                                  admin_email: settings?.admin_email
                                })}
                                className="bg-brand-peach text-white py-3 px-8 rounded-full text-sm font-bold hover:opacity-90 transition-colors"
                              >
                                {t.admin.settings.save}
                              </button>
                            </div>
                          </div>

                          <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><ImageIcon size={20} /> {t.admin.settings.logo.title}</h3>
                            <div className="space-y-6">
                              <div className="flex items-center gap-4">
                                <label className="text-sm font-bold text-[var(--text-secondary)]">{t.admin.settings.logoEnabled}</label>
                                <button 
                                  onClick={() => handleUpdateSettings({ logo_enabled: settings?.logo_enabled === '1' ? '0' : '1' })}
                                  className={`w-12 h-6 rounded-full transition-colors relative ${settings?.logo_enabled === '1' ? 'bg-brand-peach' : 'bg-gray-300 dark:bg-white/20'}`}
                                >
                                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings?.logo_enabled === '1' ? 'left-7' : 'left-1'}`} />
                                </button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Main Logo */}
                                <div className="space-y-4">
                                  <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.logo.main}</label>
                                  <div className="flex items-center gap-4">
                                    <label className="cursor-pointer bg-[var(--bg-secondary)] text-[var(--text-primary)] px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-[var(--bg-secondary)]/80 transition-colors border border-[var(--border-color)]">
                                      <ImagePlus size={18} /> {t.admin.settings.logo.select}
                                      <input 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            try {
                                              const compressedImage = await compressImage(file);
                                              setSettings(settings ? {...settings, logo_url: compressedImage} : null);
                                            } catch (error) {
                                              console.error("Error compressing image:", error);
                                              alert(t.admin.settings.logo.error);
                                            }
                                          }
                                        }}
                                      />
                                    </label>
                                    {settings?.logo_url && (
                                      <div className="relative group">
                                        <img src={settings.logo_url} className="h-12 w-auto object-contain rounded-lg border border-gray-200 dark:border-white/10 p-1 bg-white" />
                                        <button 
                                          onClick={() => setSettings(settings ? {...settings, logo_url: ''} : null)}
                                          className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shadow-md"
                                        >
                                          <X size={12} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <input 
                                    value={settings?.logo_url || ''}
                                    onChange={e => setSettings(settings ? {...settings, logo_url: e.target.value} : null)}
                                    className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)] text-sm"
                                    placeholder={t.admin.settings.logo.urlPlaceholder}
                                  />
                                </div>

                                {/* Dark Mode Logo */}
                                <div className="space-y-4">
                                  <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.logo.dark}</label>
                                  <div className="flex items-center gap-4">
                                    <label className="cursor-pointer bg-[var(--bg-secondary)] text-[var(--text-primary)] px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-[var(--bg-secondary)]/80 transition-colors border border-[var(--border-color)]">
                                      <ImagePlus size={18} /> {t.admin.settings.logo.select}
                                      <input 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            try {
                                              const compressedImage = await compressImage(file);
                                              setSettings(settings ? {...settings, logo_url_dark: compressedImage} : null);
                                            } catch (error) {
                                              console.error("Error compressing image:", error);
                                              alert(t.admin.settings.logo.error);
                                            }
                                          }
                                        }}
                                      />
                                    </label>
                                    {settings?.logo_url_dark && (
                                      <div className="relative group">
                                        <img src={settings.logo_url_dark} className="h-12 w-auto object-contain rounded-lg border border-gray-200 dark:border-white/10 p-1 bg-gray-900" />
                                        <button 
                                          onClick={() => setSettings(settings ? {...settings, logo_url_dark: ''} : null)}
                                          className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shadow-md"
                                        >
                                          <X size={12} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <input 
                                    value={settings?.logo_url_dark || ''}
                                    onChange={e => setSettings(settings ? {...settings, logo_url_dark: e.target.value} : null)}
                                    className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)] text-sm"
                                    placeholder={t.admin.settings.logo.urlPlaceholder}
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.logo.text}</label>
                                <input 
                                  value={settings?.logo_text || ''}
                                  onChange={e => setSettings(settings ? {...settings, logo_text: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <button 
                                onClick={() => handleUpdateSettings({ 
                                  logo_url: settings?.logo_url,
                                  logo_url_dark: settings?.logo_url_dark,
                                  logo_text: settings?.logo_text,
                                  logo_enabled: settings?.logo_enabled
                                })}
                                className="bg-brand-peach text-white px-8 py-3 rounded-full text-sm font-bold hover:opacity-90 transition-all shadow-lg"
                              >
                                {t.admin.settings.save}
                              </button>
                            </div>
                          </div>

                          <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                            <div className="flex justify-between items-center mb-6">
                              <h3 className="text-xl font-bold flex items-center gap-2 text-[var(--text-primary)]"><ShoppingBag size={20} /> Mercado Pago</h3>
                              <div className={`w-3 h-3 rounded-full ${apiStatus.mercadopago ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`} />
                            </div>
                            <div className="space-y-4">
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">Public Key</label>
                                <input 
                                  placeholder="APP_USR-..."
                                  value={settings?.mercadopago_public_key || ''}
                                  onChange={e => setSettings(settings ? {...settings, mercadopago_public_key: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">Access Token</label>
                                <input 
                                  type="password"
                                  placeholder="APP_USR-..."
                                  value={settings?.mercadopago_access_token || ''}
                                  onChange={e => setSettings(settings ? {...settings, mercadopago_access_token: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <button 
                                onClick={() => handleUpdateSettings({ 
                                  mercadopago_public_key: settings?.mercadopago_public_key,
                                  mercadopago_access_token: settings?.mercadopago_access_token 
                                })}
                                className="bg-brand-peach text-white px-8 py-3 rounded-full text-sm font-bold hover:opacity-90 transition-all shadow-lg"
                              >
                                {t.admin.settings.save}
                              </button>
                              <button 
                                onClick={async () => {
                                  try {
                                    const res = await fetch('/api/admin/test-mercadopago');
                                    const text = await res.text();
                                    try {
                                      const data = JSON.parse(text);
                                      alert(data.status === 'ok' ? `¡Conexión exitosa! Usuario: ${data.user}` : `Error: ${data.message}`);
                                    } catch (e) {
                                      console.error("Server response was not JSON:", text);
                                      alert(`Error del servidor: ${text.substring(0, 100)}`);
                                    }
                                  } catch (e: any) {
                                    console.error("Connection test failed:", e);
                                    alert(`Error al probar la conexión: ${e.message}`);
                                  }
                                }}
                                className="ml-2 bg-gray-200 dark:bg-white/10 text-[var(--text-primary)] px-6 py-3 rounded-full text-sm font-bold hover:opacity-90 transition-all"
                              >
                                Probar Conexión
                              </button>
                            </div>
                          </div>

                          <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                            <div className="flex justify-between items-center mb-6">
                              <h3 className="text-xl font-bold flex items-center gap-2 text-[var(--text-primary)]"><Zap size={20} /> Gemini AI</h3>
                              <div className={`w-3 h-3 rounded-full ${apiStatus.gemini ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_10_rgba(239,68,68,0.5)]'}`} />
                            </div>
                            <div className="space-y-4">
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">Nombre del Asistente</label>
                                <input 
                                  type="text"
                                  placeholder="Ej: Asistente Virtual"
                                  value={settings?.chatbot_name || ''}
                                  onChange={e => setSettings(settings ? {...settings, chatbot_name: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                                <p className="text-[10px] text-[var(--text-secondary)] mt-1">Nombre que se mostrará en el chat.</p>
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">API Key Personalizada</label>
                                <input 
                                  type="password"
                                  placeholder="Pega tu API Key aquí"
                                  value={settings?.gemini_api_key || ''}
                                  onChange={e => setSettings(settings ? {...settings, gemini_api_key: e.target.value} : null)}
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                                <p className="text-[10px] text-[var(--text-secondary)] mt-1">Si se deja vacío, se usará la clave por defecto del sistema.</p>
                              </div>
                              <div className="flex items-center gap-2 text-xs font-bold uppercase text-[var(--text-primary)]">
                                <div className={`w-2 h-2 rounded-full ${apiStatus.gemini ? 'bg-green-500' : 'bg-red-500'}`} />
                                {apiStatus.gemini ? 'Conectado' : 'Desconectado'}
                              </div>
                              <button 
                                onClick={() => handleUpdateSettings({ 
                                  gemini_api_key: settings?.gemini_api_key,
                                  chatbot_name: settings?.chatbot_name
                                })}
                                className="bg-brand-peach text-white px-8 py-3 rounded-full text-sm font-bold hover:opacity-90 transition-all shadow-lg w-full"
                              >
                                Guardar Configuración AI
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><Menu size={20} /> {t.admin.settings.menu.title}</h3>
                          <div className="space-y-4">
                            {(() => {
                              let items: MenuItem[] = [];
                              try {
                                items = settings?.menu_items ? JSON.parse(settings.menu_items) : [];
                              } catch (e) {
                                items = [];
                              }
                              return (
                                <>
                                  <div className="space-y-4">
                                    {items.map((item, index) => (
                                      <div key={item.id} className="p-4 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] space-y-4">
                                        <div className="flex justify-between items-center">
                                          <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">Item #{index + 1}</span>
                                          <button 
                                            onClick={() => {
                                              const newItems = items.filter((_, i) => i !== index);
                                              handleUpdateSettings({ menu_items: JSON.stringify(newItems) });
                                            }}
                                            className="text-red-500 hover:bg-red-500/10 p-1 rounded-lg transition-colors"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                          <div>
                                            <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.menu.label}</label>
                                            <input 
                                              value={item.label}
                                              onChange={e => {
                                                const newItems = [...items];
                                                newItems[index].label = e.target.value;
                                                setSettings(settings ? {...settings, menu_items: JSON.stringify(newItems)} : null);
                                              }}
                                              className="w-full border-b border-[var(--border-color)] py-1 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                            />
                                          </div>
                                          <div>
                                            <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.menu.type}</label>
                                            <select 
                                              value={item.type}
                                              onChange={e => {
                                                const newItems = [...items];
                                                newItems[index].type = e.target.value as any;
                                                newItems[index].link = e.target.value === 'category' ? (categories[0]?.name || '') : '';
                                                setSettings(settings ? {...settings, menu_items: JSON.stringify(newItems)} : null);
                                              }}
                                              className="w-full border-b border-[var(--border-color)] py-1 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                            >
                                              <option value="custom" className="bg-[var(--bg-primary)]">{t.admin.settings.menu.custom}</option>
                                              <option value="category" className="bg-[var(--bg-primary)]">{t.admin.settings.menu.category}</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.menu.link}</label>
                                            {item.type === 'category' ? (
                                              <select 
                                                value={item.link}
                                                onChange={e => {
                                                  const newItems = [...items];
                                                  newItems[index].link = e.target.value;
                                                  setSettings(settings ? {...settings, menu_items: JSON.stringify(newItems)} : null);
                                                }}
                                                className="w-full border-b border-[var(--border-color)] py-1 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                              >
                                                <option value="Todos" className="bg-[var(--bg-primary)]">Todos</option>
                                                {categories.map(c => <option key={c.id} value={c.name} className="bg-[var(--bg-primary)]">{c.name}</option>)}
                                              </select>
                                            ) : (
                                              <input 
                                                value={item.link}
                                                onChange={e => {
                                                  const newItems = [...items];
                                                  newItems[index].link = e.target.value;
                                                  setSettings(settings ? {...settings, menu_items: JSON.stringify(newItems)} : null);
                                                }}
                                                className="w-full border-b border-[var(--border-color)] py-1 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                                placeholder="/catalogo, https://..."
                                              />
                                            )}
                                          </div>
                                          <div>
                                            <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.menu.icon}</label>
                                            <div className="space-y-2">
                                              <div className="flex gap-2">
                                                <select 
                                                  value={item.icon.startsWith('data:') ? 'custom' : item.icon}
                                                  onChange={e => {
                                                    const newItems = [...items];
                                                    newItems[index].icon = e.target.value;
                                                    setSettings(settings ? {...settings, menu_items: JSON.stringify(newItems)} : null);
                                                  }}
                                                  className="flex-1 border-b border-[var(--border-color)] py-1 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                                >
                                                  <option value="custom" className="bg-[var(--bg-primary)]">Personalizado / IA</option>
                                                  {['ShoppingBag', 'Zap', 'LayoutGrid', 'List', 'Phone', 'Globe', 'Package', 'User', 'Clock', 'Heart', 'Star', 'Tag'].map(icon => (
                                                    <option key={icon} value={icon} className="bg-[var(--bg-primary)]">{icon}</option>
                                                  ))}
                                                </select>
                                                {item.icon.startsWith('data:') && (
                                                  <div className="w-8 h-8 rounded-lg bg-brand-peach/10 flex items-center justify-center overflow-hidden border border-brand-peach/20">
                                                    <img src={item.icon} className="w-full h-full object-contain p-1" />
                                                  </div>
                                                )}
                                              </div>
                                              
                                              <div className="flex flex-col gap-2 p-3 bg-[var(--bg-secondary)] rounded-xl border border-brand-peach/10">
                                                <div className="flex gap-2">
                                                  <input 
                                                    placeholder="Prompt para IA (ej: un perfume elegante)"
                                                    value={aiIconPrompts[item.id] || ''}
                                                    onChange={e => setAiIconPrompts({...aiIconPrompts, [item.id]: e.target.value})}
                                                    className="flex-1 text-[10px] bg-transparent border-b border-[var(--border-color)] outline-none focus:border-brand-peach text-[var(--text-primary)]"
                                                  />
                                                  <button 
                                                    onClick={() => handleAiIconGenerate(index, aiIconPrompts[item.id] || item.label)}
                                                    disabled={aiLoading}
                                                    className="p-1.5 bg-brand-peach text-white rounded-lg hover:scale-105 transition-transform disabled:opacity-50"
                                                    title="Generar con IA"
                                                  >
                                                    <Wand2 size={12} />
                                                  </button>
                                                  <label className="p-1.5 bg-brand-peach/10 text-brand-peach rounded-lg hover:scale-105 transition-transform cursor-pointer" title="Usar foto de base">
                                                    <Camera size={12} />
                                                    <input 
                                                      type="file" 
                                                      accept="image/*" 
                                                      className="hidden" 
                                                      onChange={async (e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                          try {
                                                            const compressedImage = await compressImage(file);
                                                            handleAiIconGenerate(index, aiIconPrompts[item.id] || item.label, compressedImage);
                                                          } catch (error) {
                                                            console.error("Error compressing image:", error);
                                                            alert("Error al procesar la imagen.");
                                                          }
                                                        }
                                                      }}
                                                    />
                                                  </label>
                                                </div>
                                                <p className="text-[8px] text-[var(--text-secondary)] italic">La IA adaptará el icono al color durazno del sitio.</p>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex gap-4">
                                    <button 
                                      onClick={() => {
                                        const newItem: MenuItem = { id: Date.now().toString(), label: 'Nuevo Item', link: '/', icon: 'ShoppingBag', type: 'custom' };
                                        handleUpdateSettings({ menu_items: JSON.stringify([...items, newItem]) });
                                      }}
                                      className="flex items-center gap-2 bg-brand-peach/10 text-brand-peach px-6 py-2 rounded-full text-sm font-bold hover:bg-brand-peach/20 transition-colors"
                                    >
                                      <Plus size={16} /> {t.admin.settings.menu.addItem}
                                    </button>
                                    <button 
                                      onClick={() => handleUpdateSettings({ menu_items: JSON.stringify(items) })}
                                      className="bg-brand-peach text-white px-6 py-2 rounded-full text-sm font-bold hover:opacity-90 transition-all"
                                    >
                                      Guardar Cambios
                                    </button>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>

                        <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><Clock size={20} /> {t.admin.settings.businessHours.title}</h3>
                          {(() => {
                            let hours: BusinessHours = { enabled: false, start: '09:00', end: '18:00', days: [1,2,3,4,5] };
                            try {
                              hours = settings?.business_hours ? JSON.parse(settings.business_hours) : hours;
                            } catch (e) {}
                            
                            const days = [
                              { id: 0, label: t.admin.settings.businessHours.sunday },
                              { id: 1, label: t.admin.settings.businessHours.monday },
                              { id: 2, label: t.admin.settings.businessHours.tuesday },
                              { id: 3, label: t.admin.settings.businessHours.wednesday },
                              { id: 4, label: t.admin.settings.businessHours.thursday },
                              { id: 5, label: t.admin.settings.businessHours.friday },
                              { id: 6, label: t.admin.settings.businessHours.saturday },
                            ];

                            return (
                              <div className="space-y-6">
                                <div className="flex items-center gap-4">
                                  <label className="text-sm font-bold text-[var(--text-primary)]">{t.admin.settings.businessHours.enabled}</label>
                                  <button 
                                    onClick={() => {
                                      const newHours = { ...hours, enabled: !hours.enabled };
                                      handleUpdateSettings({ business_hours: JSON.stringify(newHours) });
                                    }}
                                    className={`w-12 h-6 rounded-full transition-colors relative ${hours.enabled ? 'bg-brand-peach' : 'bg-[var(--border-color)]'}`}
                                  >
                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${hours.enabled ? 'left-7' : 'left-1'}`} />
                                  </button>
                                </div>

                                <div className="grid grid-cols-2 gap-8">
                                  <div>
                                    <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.businessHours.start}</label>
                                    <input 
                                      type="time"
                                      value={hours.start}
                                      onChange={e => {
                                        const newHours = { ...hours, start: e.target.value };
                                        setSettings(settings ? {...settings, business_hours: JSON.stringify(newHours)} : null);
                                      }}
                                      className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.businessHours.end}</label>
                                    <input 
                                      type="time"
                                      value={hours.end}
                                      onChange={e => {
                                        const newHours = { ...hours, end: e.target.value };
                                        setSettings(settings ? {...settings, business_hours: JSON.stringify(newHours)} : null);
                                      }}
                                      className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                    />
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-4">{t.admin.settings.businessHours.days}</label>
                                  <div className="flex flex-wrap gap-2">
                                    {days.map(day => (
                                      <button 
                                        key={day.id}
                                        onClick={() => {
                                          const newDays = hours.days.includes(day.id) 
                                            ? hours.days.filter(d => d !== day.id)
                                            : [...hours.days, day.id];
                                          const newHours = { ...hours, days: newDays };
                                          setSettings(settings ? {...settings, business_hours: JSON.stringify(newHours)} : null);
                                        }}
                                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${hours.days.includes(day.id) ? 'bg-brand-peach text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)]'}`}
                                      >
                                        {day.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <button 
                                  onClick={() => handleUpdateSettings({ business_hours: JSON.stringify(hours) })}
                                  className="bg-brand-peach text-white px-10 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg"
                                >
                                  {t.admin.settings.save}
                                </button>
                              </div>
                            );
                          })()}
                        </div>

                        <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><MessageSquare size={20} /> {t.admin.settings.chatbot.title}</h3>
                          <div className="space-y-6">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.chatbot.name}</label>
                              <input 
                                value={settings?.chatbot_name || ''}
                                onChange={e => setSettings(settings ? {...settings, chatbot_name: e.target.value} : null)}
                                placeholder="Ej: Sorellita"
                                className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.chatbot.unavailableMessage}</label>
                              <p className="text-xs text-[var(--text-secondary)] mb-2">{t.admin.settings.chatbot.unavailableMessageHelp}</p>
                              <textarea 
                                value={settings?.chatbot_unavailable_message || ''}
                                onChange={e => setSettings(settings ? {...settings, chatbot_unavailable_message: e.target.value} : null)}
                                placeholder="El asistente virtual está temporalmente fuera de servicio..."
                                className="w-full border border-[var(--border-color)] rounded-xl p-3 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)] min-h-[100px] resize-y"
                              />
                            </div>
                            <button 
                              onClick={() => handleUpdateSettings({ 
                                chatbot_name: settings?.chatbot_name,
                                chatbot_unavailable_message: settings?.chatbot_unavailable_message
                              })}
                              className="bg-brand-peach text-white px-10 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg"
                            >
                              {t.admin.settings.save}
                            </button>
                          </div>
                        </div>

                        <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><Package size={20} /> {t.admin.settings.shipping.title}</h3>
                          <p className="text-sm text-[var(--text-secondary)] mb-6">{t.admin.settings.shipping.help}</p>
                          <div className="space-y-6">
                            <div className="grid md:grid-cols-2 gap-6">
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.shipping.cabaSucursal}</label>
                                <input 
                                  value={settings?.shipping_caba_sucursal || ''}
                                  onChange={e => setSettings(settings ? {...settings, shipping_caba_sucursal: e.target.value} : null)}
                                  placeholder="$4.500 - $6.200"
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.shipping.cabaDomicilio}</label>
                                <input 
                                  value={settings?.shipping_caba_domicilio || ''}
                                  onChange={e => setSettings(settings ? {...settings, shipping_caba_domicilio: e.target.value} : null)}
                                  placeholder="$6.000 - $8.500"
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.shipping.nacionalSucursal}</label>
                                <input 
                                  value={settings?.shipping_nacional_sucursal || ''}
                                  onChange={e => setSettings(settings ? {...settings, shipping_nacional_sucursal: e.target.value} : null)}
                                  placeholder="$7.500 - $11.000"
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.shipping.nacionalDomicilio}</label>
                                <input 
                                  value={settings?.shipping_nacional_domicilio || ''}
                                  onChange={e => setSettings(settings ? {...settings, shipping_nacional_domicilio: e.target.value} : null)}
                                  placeholder="$11.000 - $18.000"
                                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                                />
                              </div>
                            </div>
                            <button 
                              onClick={() => handleUpdateSettings({ 
                                shipping_caba_sucursal: settings?.shipping_caba_sucursal,
                                shipping_caba_domicilio: settings?.shipping_caba_domicilio,
                                shipping_nacional_sucursal: settings?.shipping_nacional_sucursal,
                                shipping_nacional_domicilio: settings?.shipping_nacional_domicilio
                              })}
                              className="bg-brand-peach text-white px-10 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg"
                            >
                              {t.admin.settings.save}
                            </button>
                          </div>
                        </div>

                        <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><Layout size={20} /> Barra de Anuncio</h3>
                          <div className="space-y-4">
                            <div className="flex items-center gap-4">
                              <label className="text-sm font-bold text-[var(--text-primary)]">Habilitar Barra</label>
                              <button 
                                onClick={() => handleUpdateSettings({ announcement_enabled: settings?.announcement_enabled === '1' ? '0' : '1' })}
                                className={`w-12 h-6 rounded-full transition-colors relative ${settings?.announcement_enabled === '1' ? 'bg-brand-peach' : 'bg-[var(--border-color)]'}`}
                              >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings?.announcement_enabled === '1' ? 'left-7' : 'left-1'}`} />
                              </button>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">Texto del Anuncio</label>
                              <input 
                                value={settings?.announcement_text || ''}
                                onChange={e => setSettings(settings ? {...settings, announcement_text: e.target.value} : null)}
                                className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">Color de Fondo</label>
                                <div className="flex gap-2 items-center">
                                  <input 
                                    type="color"
                                    value={settings?.announcement_bg || '#2D241E'}
                                    onChange={e => setSettings(settings ? {...settings, announcement_bg: e.target.value} : null)}
                                    className="w-8 h-8 rounded-full overflow-hidden border-none cursor-pointer"
                                  />
                                  <span className="text-xs font-mono text-[var(--text-primary)]">{settings?.announcement_bg}</span>
                                </div>
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">Color de Texto</label>
                                <div className="flex gap-2 items-center">
                                  <input 
                                    type="color"
                                    value={settings?.announcement_text_color || '#FFFFFF'}
                                    onChange={e => setSettings(settings ? {...settings, announcement_text_color: e.target.value} : null)}
                                    className="w-8 h-8 rounded-full overflow-hidden border-none cursor-pointer"
                                  />
                                  <span className="text-xs font-mono text-[var(--text-primary)]">{settings?.announcement_text_color}</span>
                                </div>
                              </div>
                            </div>
                            <button 
                              onClick={() => handleUpdateSettings({ 
                                announcement_enabled: settings?.announcement_enabled,
                                announcement_text: settings?.announcement_text,
                                announcement_bg: settings?.announcement_bg,
                                announcement_text_color: settings?.announcement_text_color
                              })}
                              className="bg-brand-peach text-white px-10 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all w-full shadow-lg"
                            >
                              {t.admin.settings.save}
                            </button>
                          </div>
                        </div>

                        <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><Palette size={20} /> {t.admin.settings.cursor.title}</h3>
                          <div className="space-y-6">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.cursor.type}</label>
                              <select 
                                value={settings?.cursor_type || 'default'} 
                                onChange={e => setSettings(settings ? {...settings, cursor_type: e.target.value} : null)}
                                className="w-full p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                              >
                                <option value="default">{t.admin.settings.cursor.default}</option>
                                <option value="hanger">{t.admin.settings.cursor.hanger}</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.cursor.speed}</label>
                              <select 
                                value={settings?.cursor_speed || 'slow'} 
                                onChange={e => setSettings(settings ? {...settings, cursor_speed: e.target.value} : null)}
                                className="w-full p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                              >
                                <option value="slow">{t.admin.settings.cursor.slow}</option>
                                <option value="medium">{t.admin.settings.cursor.medium}</option>
                                <option value="fast">{t.admin.settings.cursor.fast}</option>
                              </select>
                            </div>
                            <button 
                              onClick={() => handleUpdateSettings({ cursor_type: settings?.cursor_type, cursor_speed: settings?.cursor_speed })}
                              className="bg-brand-peach text-white px-10 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all w-full shadow-lg"
                            >
                              {t.admin.settings.save}
                            </button>
                          </div>
                        </div>

                        <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><Layout size={20} /> {t.admin.settings.maintenance.title}</h3>
                          <div className="space-y-6">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-bold text-[var(--text-secondary)]">{t.admin.settings.maintenance.enabled}</label>
                              <button 
                                onClick={() => handleUpdateSettings({ maintenance_mode: !settings?.maintenance_mode })}
                                className={`w-14 h-8 rounded-full transition-colors ${settings?.maintenance_mode ? 'bg-brand-peach' : 'bg-[var(--bg-secondary)]'}`}
                              >
                                <div className={`w-6 h-6 rounded-full bg-white transition-transform ${settings?.maintenance_mode ? 'translate-x-7' : 'translate-x-1'}`} />
                              </button>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.maintenance.message}</label>
                              <input 
                                type="text"
                                value={settings?.maintenance_message || ''}
                                onChange={e => setSettings(settings ? {...settings, maintenance_message: e.target.value} : null)}
                                placeholder={t.admin.settings.maintenance.messagePlaceholder}
                                className="w-full p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                              />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.maintenance.image}</label>
                                <div className="space-y-3">
                                  <input 
                                    type="text"
                                    value={settings?.maintenance_image || ''}
                                    onChange={e => setSettings(settings ? {...settings, maintenance_image: e.target.value} : null)}
                                    placeholder="https://..."
                                    className="w-full p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                                  />
                                  <input 
                                    type="file" 
                                    id="maintenance-image-upload"
                                    accept="image/*"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        try {
                                          const compressedImage = await compressImage(file);
                                          setSettings(settings ? { ...settings, maintenance_image: compressedImage } : null);
                                        } catch (error) {
                                          console.error("Error compressing image:", error);
                                          alert("Error al procesar la imagen.");
                                        }
                                      }
                                    }}
                                    className="hidden"
                                  />
                                  <label 
                                    htmlFor="maintenance-image-upload"
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs font-bold cursor-pointer hover:bg-brand-peach hover:text-white transition-all border border-[var(--border-color)]"
                                  >
                                    <ImageIcon size={14} /> {t.admin.settings.maintenance.selectImage}
                                  </label>
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.maintenance.blur}</label>
                                <div className="flex items-center gap-4">
                                  <input 
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={settings?.maintenance_blur || 0}
                                    onChange={e => setSettings(settings ? {...settings, maintenance_blur: parseInt(e.target.value)} : null)}
                                    className="flex-1 accent-brand-peach"
                                  />
                                  <span className="text-xs font-bold text-[var(--text-primary)] w-8">{settings?.maintenance_blur || 0}%</span>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.maintenance.bgColor}</label>
                                <div className="flex items-center gap-3">
                                  <input 
                                    type="color"
                                    value={settings?.maintenance_bg_color || '#ffffff'}
                                    onChange={e => setSettings(settings ? {...settings, maintenance_bg_color: e.target.value} : null)}
                                    className="w-10 h-10 rounded-full border-0 p-0 cursor-pointer overflow-hidden"
                                  />
                                  <input 
                                    type="text"
                                    value={settings?.maintenance_bg_color || ''}
                                    onChange={e => setSettings(settings ? {...settings, maintenance_bg_color: e.target.value} : null)}
                                    placeholder="#ffffff"
                                    className="flex-1 p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                                  />
                                </div>
                                <div className="mt-3">
                                  <p className="text-[9px] font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.settings.maintenance.pastelColors}</p>
                                  <div className="flex flex-wrap gap-2">
                                    {['#FFF5F2', '#F9E8E8', '#F3F0F9', '#F0F9F4', '#F0F6F9'].map(color => (
                                      <button 
                                        key={color}
                                        onClick={() => setSettings(settings ? {...settings, maintenance_bg_color: color} : null)}
                                        className="w-6 h-6 rounded-full border border-[var(--border-color)] hover:scale-110 transition-transform"
                                        style={{ backgroundColor: color }}
                                        title={color}
                                      />
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.maintenance.textColor}</label>
                                <div className="flex items-center gap-3">
                                  <input 
                                    type="color"
                                    value={settings?.maintenance_text_color || '#000000'}
                                    onChange={e => setSettings(settings ? {...settings, maintenance_text_color: e.target.value} : null)}
                                    className="w-10 h-10 rounded-full border-0 p-0 cursor-pointer overflow-hidden"
                                  />
                                  <input 
                                    type="text"
                                    value={settings?.maintenance_text_color || ''}
                                    onChange={e => setSettings(settings ? {...settings, maintenance_text_color: e.target.value} : null)}
                                    placeholder="#000000"
                                    className="flex-1 p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                                  />
                                </div>
                              </div>
                            </div>

                            <button 
                              onClick={() => handleUpdateSettings({ 
                                maintenance_mode: settings?.maintenance_mode, 
                                maintenance_message: settings?.maintenance_message,
                                maintenance_image: settings?.maintenance_image,
                                maintenance_bg_color: settings?.maintenance_bg_color,
                                maintenance_text_color: settings?.maintenance_text_color,
                                maintenance_blur: settings?.maintenance_blur
                              })}
                              className="bg-brand-peach text-white px-10 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all w-full shadow-lg"
                            >
                              {t.admin.settings.save}
                            </button>
                          </div>
                        </div>

                        <div className="p-8 bg-[var(--bg-primary)] rounded-[40px] border border-[var(--border-color)]">
                          <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-[var(--text-primary)]"><Layout size={20} /> {t.admin.settings.marketingHome.title}</h3>
                          <div className="space-y-6">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.marketingHome.featuredCategory}</label>
                              <select 
                                value={settings?.featured_category || ''}
                                onChange={e => setSettings(settings ? {...settings, featured_category: e.target.value} : null)}
                                className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                              >
                                <option value="" className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{t.admin.settings.marketingHome.none}</option>
                                {categories.map(cat => (
                                  <option key={cat.id} value={cat.name} className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{cat.name}</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{t.admin.settings.marketingHome.lanzamientosCategory}</label>
                              <select 
                                value={settings?.lanzamientos_category || ''}
                                onChange={e => setSettings(settings ? {...settings, lanzamientos_category: e.target.value} : null)}
                                className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                              >
                                <option value="" className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{t.admin.settings.marketingHome.all}</option>
                                {categories.map(cat => (
                                  <option key={cat.id} value={cat.name} className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{cat.name}</option>
                                ))}
                              </select>
                              <p className="text-[10px] text-[var(--text-secondary)] mt-1 italic">{t.admin.settings.marketingHome.lanzamientosHelp}</p>
                            </div>

                            <button 
                              onClick={() => handleUpdateSettings({ 
                                featured_category: settings?.featured_category,
                                lanzamientos_category: settings?.lanzamientos_category
                              })}
                              className="bg-brand-peach text-white px-10 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-all shadow-lg"
                            >
                              {t.admin.settings.save}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {adminTab === 'sales' && (
                      <SalesManagement 
                        orders={orders} 
                        t={t} 
                        onUpdateStatus={async (id, status) => {
                          try {
                            await updateOrderStatus(String(id), status);
                            const order = orders.find(o => String(o.id) === String(id));
                            if (order) {
                              await fetch('/api/notify-status', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  order_number: order.order_number,
                                  customer_email: order.customer_email,
                                  status
                                })
                              });
                            }
                            await fetchData();
                          } catch (err) {
                            console.error("Error updating status:", err);
                            alert("Error al actualizar el estado.");
                          }
                        }}
                        onDeleteOrder={async (id) => {
                          try {
                            await deleteOrder(id);
                            await fetchData();
                          } catch (err) {
                            console.error("Error deleting order:", err);
                            alert("Error al eliminar el pedido. Verifica los permisos.");
                          }
                        }}
                        onDeleteOrders={async (ids) => {
                          try {
                            await Promise.all(ids.map(id => deleteOrder(id)));
                            await fetchData();
                          } catch (err) {
                            console.error("Error deleting orders:", err);
                            alert("Error al eliminar los pedidos. Verifica los permisos.");
                          }
                        }}
                      />
                    )}

                    {adminTab === 'categories' && (
                      <section className="text-[var(--text-primary)]">
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-lg font-bold text-[var(--text-primary)]">Categorías</h3>
                          <button 
                            onClick={() => setEditingCategory({ name: '', image_url: '', description: '', gallery: [] })}
                            className="bg-brand-peach text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:opacity-90 transition-colors"
                          >
                            <Plus size={18} /> Nueva Categoría
                          </button>
                        </div>
                        <div className="grid gap-4">
                          {categories.map(cat => (
                            <div key={cat.id} className="flex items-center justify-between p-4 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)]">
                              <div className="flex items-center gap-4">
                                <img src={cat.image_url || undefined} className="w-16 h-16 rounded-lg object-cover border border-[var(--border-color)]" referrerPolicy="no-referrer" />
                                <div>
                                  <p className="font-bold text-[var(--text-primary)]">{cat.name}</p>
                                  <p className="text-xs text-[var(--text-secondary)]">{cat.description}</p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => setEditingCategory(cat)} className="p-2 hover:bg-[var(--bg-primary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"><Edit size={18} /></button>
                                <button 
                                  onClick={async () => {
                                    if (confirm('¿Eliminar categoría?')) {
                                      await deleteCategory(String(cat.id));
                                      fetchData();
                                    }
                                  }}
                                  className="p-2 hover:bg-[var(--bg-primary)] rounded-lg text-red-500 hover:text-red-600 transition-colors"
                                ><Trash2 size={18} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {adminTab === 'banners' && (
                      <section className="text-[var(--text-primary)]">
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-lg font-bold text-[var(--text-primary)]">Banners</h3>
                          <button 
                            onClick={() => setEditingBanner({ title: '', subtitle: '', button_text: '', button_link: '', image_url: '', is_fixed: false, order_index: 0 })}
                            className="bg-brand-peach text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:opacity-90 transition-all"
                          >
                            <Plus size={18} /> Nuevo Banner
                          </button>
                        </div>
                        <div className="grid gap-4">
                          {banners.map(banner => (
                            <div key={banner.id} className="flex items-center justify-between p-4 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)]">
                              <div className="flex items-center gap-4">
                                <img src={banner.image_url || undefined} className="w-20 h-12 rounded-lg object-cover border border-[var(--border-color)]" referrerPolicy="no-referrer" />
                                <div>
                                  <p className="font-bold text-[var(--text-primary)]">{banner.title}</p>
                                  <p className="text-xs text-[var(--text-secondary)]">Orden: {banner.order_index} • {banner.subtitle}</p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => setEditingBanner(banner)} className="p-2 hover:bg-[var(--bg-primary)] rounded-lg text-blue-500 dark:text-blue-400"><Edit size={18} /></button>
                                <button 
                                  onClick={async () => {
                                    if (confirm('¿Eliminar banner?')) {
                                      await deleteBanner(String(banner.id));
                                      fetchData();
                                    }
                                  }}
                                  className="p-2 hover:bg-[var(--bg-primary)] rounded-lg text-red-500 dark:text-red-400"
                                ><Trash2 size={18} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {adminTab === 'filters' && (
                      <section>
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-lg font-bold text-[var(--text-primary)]">Filtros</h3>
                          <button 
                            onClick={() => setEditingFilter({ name: '', options: [] })}
                            className="bg-brand-peach text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:opacity-90 transition-all"
                          >
                            <Plus size={18} /> Nuevo Filtro
                          </button>
                        </div>
                        <div className="grid gap-4">
                          {filters.map(f => (
                            <div key={f.id} className="flex items-center justify-between p-4 bg-[var(--bg-primary)] rounded-2xl border border-[var(--border-color)]">
                              <div>
                                <p className="font-bold text-[var(--text-primary)]">{f.name}</p>
                                <p className="text-xs text-[var(--text-secondary)]">{f.options.join(', ')}</p>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => setEditingFilter(f)} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-blue-500 dark:text-blue-400"><Edit size={18} /></button>
                                <button 
                                  onClick={async () => {
                                    if (confirm('¿Eliminar filtro?')) {
                                      await deleteFilter(String(f.id));
                                      fetchData();
                                    }
                                  }}
                                  className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-red-500 dark:text-red-400"
                                ><Trash2 size={18} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    {adminTab === 'products' && (
                      <section>
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-lg font-bold text-[var(--text-primary)]">Inventario</h3>
                          <button 
                            onClick={() => setEditingProduct({
                              name: '', description: '', price: 0, category: categories[0]?.name || 'Ropa', stock: 10,
                              sizes: [], colors: [], fragrances: [], image_url: '', gallery: []
                            })}
                            className="bg-brand-peach text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:opacity-90 transition-all"
                          >
                            <Plus size={18} /> Nuevo Producto
                          </button>
                        </div>

                        <div className="grid gap-4">
                          {products.map(p => (
                            <div key={p.id} className="flex items-center justify-between p-4 bg-[var(--bg-primary)] rounded-2xl border border-[var(--border-color)]">
                              <div className="flex items-center gap-4">
                                <img src={p.image_url || undefined} className="w-12 h-12 rounded-lg object-cover border border-[var(--border-color)]" referrerPolicy="no-referrer" />
                                <div>
                                  <p className="font-bold text-[var(--text-primary)]">{p.name}</p>
                                  <p className="text-xs text-[var(--text-secondary)]">{p.category} • ${p.price}</p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => setEditingProduct(p)} className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-blue-500 dark:text-blue-400"><Edit size={18} /></button>
                                <button 
                                  onClick={async () => {
                                    if (confirm('¿Eliminar producto?')) {
                                      await deleteProduct(String(p.id));
                                      fetchData();
                                    }
                                  }}
                                  className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg text-red-500 dark:text-red-400"
                                ><Trash2 size={18} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

      {/* Filter Edit Modal */}
      <AnimatePresence>
        {editingFilter && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-[var(--bg-primary)] w-full max-w-md rounded-[40px] p-8 shadow-2xl border border-[var(--border-color)]"
            >
              <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-6">{editingFilter.id ? 'Editar' : 'Nuevo'} Filtro</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Nombre del Filtro</label>
                  <input 
                    required
                    value={editingFilter.name}
                    onChange={e => setEditingFilter({...editingFilter, name: e.target.value})}
                    className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Opciones (separadas por coma)</label>
                  <input 
                    required
                    value={editingFilter.options.join(', ')}
                    onChange={e => setEditingFilter({...editingFilter, options: e.target.value.split(',').map(o => o.trim())})}
                    className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                  />
                </div>
              </div>
              <div className="flex gap-4 mt-8">
                <button type="button" onClick={() => setEditingFilter(null)} className="flex-1 bg-[var(--bg-secondary)] py-4 rounded-2xl font-bold text-[var(--text-primary)] hover:opacity-80 transition-colors">Cancelar</button>
                <button 
                  onClick={async () => {
                    await saveFilter(editingFilter.id || null, editingFilter);
                    setEditingFilter(null);
                    fetchData();
                  }}
                  className="flex-1 bg-brand-peach text-white py-4 rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg"
                >
                  Guardar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingProduct && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-[var(--bg-primary)] w-full max-w-2xl max-h-[85vh] rounded-[40px] overflow-hidden flex flex-col shadow-2xl border border-[var(--border-color)]"
            >
              <form onSubmit={handleSaveProduct} className="flex flex-col min-h-0 flex-1">
                <div className="p-6 md:p-8 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-primary)] z-10">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-[var(--text-primary)]">{editingProduct.id ? 'Editar' : 'Nuevo'} Producto</h2>
                    <button
                      type="button"
                      onClick={() => handleAITranslate('product')}
                      disabled={aiLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-brand-peach/10 text-brand-peach rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-peach/20 transition-all disabled:opacity-50"
                    >
                      <Icons.Languages size={14} />
                      {aiLoading ? 'Traduciendo...' : 'Traducir con IA'}
                    </button>
                  </div>
                  <button type="button" onClick={() => setEditingProduct(null)} className="p-2 hover:bg-[var(--bg-secondary)] rounded-full transition-colors text-[var(--text-primary)]"><X /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar bg-[var(--bg-primary)]">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Descripción</label>
                      <textarea 
                        required
                        value={editingProduct.description}
                        onChange={e => setEditingProduct({...editingProduct, description: e.target.value})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)] min-h-[100px]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Nombre</label>
                      <input 
                        required
                        value={editingProduct.name}
                        onChange={e => setEditingProduct({...editingProduct, name: e.target.value})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Precio</label>
                      <input 
                        required
                        type="number"
                        value={editingProduct.price}
                        onChange={e => setEditingProduct({...editingProduct, price: Number(e.target.value)})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Descuento (%)</label>
                      <input 
                        type="number"
                        min="0"
                        max="100"
                        value={editingProduct.discount_percentage || 0}
                        onChange={e => setEditingProduct({...editingProduct, discount_percentage: Number(e.target.value)})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Stock</label>
                      <input 
                        required
                        type="number"
                        min="0"
                        value={editingProduct.stock || 0}
                        onChange={e => setEditingProduct({...editingProduct, stock: Number(e.target.value)})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Stock</label>
                      <input 
                        required
                        type="number"
                        min="0"
                        value={editingProduct.stock || 0}
                        onChange={e => setEditingProduct({...editingProduct, stock: Number(e.target.value)})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Categorías (Selecciona múltiples)</label>
                    <div className="flex flex-wrap gap-2 p-4 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)]">
                      {categories.map(cat => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            const currentCats = editingProduct.categories || [];
                            const newCats = currentCats.includes(cat.name)
                              ? currentCats.filter(c => c !== cat.name)
                              : [...currentCats, cat.name];
                            setEditingProduct({
                              ...editingProduct, 
                              categories: newCats,
                              category: newCats[0] || '' // Keep first for backward compatibility
                            });
                          }}
                          className={`px-4 py-2 rounded-full text-xs font-bold transition-all border ${
                            (editingProduct.categories || []).includes(cat.name)
                              ? 'bg-brand-peach text-white border-brand-peach'
                              : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-brand-peach/50'
                          }`}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filters.length > 0 && (
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Filtros Adicionales</label>
                      <div className="grid md:grid-cols-2 gap-4">
                        {filters.map(f => (
                          <div key={f.id}>
                            <label className="block text-[10px] font-bold uppercase text-[var(--text-secondary)] mb-1">{f.name}</label>
                            <select
                              value={editingProduct.filters?.[f.name] || ''}
                              onChange={e => setEditingProduct({
                                ...editingProduct,
                                filters: { ...editingProduct.filters, [f.name]: e.target.value }
                              })}
                              className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                            >
                              <option value="">Seleccionar...</option>
                              {f.options.map(o => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Imagen (URL o Subir)</label>
                    <div className="flex flex-col md:flex-row gap-6 items-start">
                      <div className="flex-1 w-full space-y-4">
                        <input 
                          value={editingProduct.image_url}
                          onChange={e => setEditingProduct({...editingProduct, image_url: e.target.value})}
                          className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                          placeholder="https://..."
                        />
                        <div>
                          <input 
                            type="file" 
                            id="product-image-upload"
                            accept="image/*"
                            multiple
                            onChange={async (e) => {
                              const files = Array.from(e.target.files || []) as File[];
                              if (files.length > 0) {
                                try {
                                  const compressedImages = await Promise.all(
                                    files.map((file: File) => compressImage(file))
                                  );
                                  
                                  const newGallery = [...(editingProduct.gallery || []), ...compressedImages];
                                  
                                  setEditingProduct({ 
                                    ...editingProduct, 
                                    image_url: editingProduct.image_url || compressedImages[0],
                                    gallery: newGallery 
                                  });
                                } catch (error) {
                                  console.error("Error compressing image:", error);
                                  alert("Error al procesar las imágenes.");
                                }
                              }
                            }}
                            className="hidden"
                          />
                          <label 
                            htmlFor="product-image-upload"
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs font-bold cursor-pointer hover:bg-brand-peach hover:text-white transition-all border border-[var(--border-color)]"
                          >
                            <ImageIcon size={14} /> Seleccionar Archivo
                          </label>
                        </div>
                        
                        <div className="p-5 bg-[var(--bg-secondary)] rounded-3xl border border-[var(--border-color)]">
                          <p className="text-xs font-bold mb-3 flex items-center gap-2 text-[var(--text-primary)]"><Wand2 size={14} /> IA Image Editor (Gemini)</p>
                          <textarea 
                            value={aiPrompt}
                            onChange={e => setAiPrompt(e.target.value)}
                            placeholder="Ej: pon esta remera en un modelo en la playa..."
                            className="w-full bg-[var(--bg-primary)] rounded-2xl p-4 text-sm outline-none mb-3 shadow-sm focus:ring-2 ring-brand-peach/20 transition-all min-h-[80px] text-[var(--text-primary)]"
                          />
                          <button 
                            type="button"
                            onClick={handleAiEdit}
                            disabled={aiLoading}
                            className="w-full bg-brand-peach text-white py-3 rounded-2xl text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 shadow-lg"
                          >
                            {aiLoading ? 'Generando...' : 'Aplicar IA'}
                          </button>
                          <p className="text-[10px] text-[var(--text-secondary)] mt-3 italic">Nota: Solo funciona con imágenes subidas (base64).</p>
                        </div>
                      </div>
                      
                      <div className="w-full md:w-40 flex flex-col gap-3">
                        <div className="aspect-[3/4] bg-[var(--bg-secondary)] rounded-3xl overflow-hidden shadow-inner border-4 border-[var(--border-color)] relative group">
                          {editingProduct.image_url ? (
                            <>
                              <img src={editingProduct.image_url || undefined} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              <div className="absolute inset-x-0 bottom-0 pb-3 pt-8 bg-gradient-to-t from-black/80 to-transparent flex flex-col items-center justify-end gap-2 md:inset-0 md:bg-black/40 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:justify-center transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const gallery = editingProduct.gallery || [];
                                    if (!gallery.includes(editingProduct.image_url)) {
                                      setEditingProduct({ ...editingProduct, gallery: [...gallery, editingProduct.image_url] });
                                      alert('Imagen guardada en la galería');
                                    }
                                  }}
                                  className="bg-white text-brand-dark px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 hover:bg-brand-peach hover:text-white transition-colors"
                                >
                                  <ImagePlus size={12} /> Guardar en Galería
                                </button>
                                {editingProduct.image_url.startsWith('data:image') && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const link = document.createElement('a');
                                      link.href = editingProduct.image_url;
                                      link.download = `sorella-product-${Date.now()}.png`;
                                      link.click();
                                    }}
                                    className="bg-white text-brand-dark px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 hover:bg-brand-peach hover:text-white transition-colors"
                                  >
                                    <Save size={12} /> Descargar
                                  </button>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-secondary)] gap-2">
                              <ImageIcon size={32} />
                              <span className="text-[10px] font-bold uppercase">Sin imagen</span>
                            </div>
                          )}
                        </div>
                        
                        {/* Gallery Preview */}
                        <div className="grid grid-cols-3 gap-2">
                          {(editingProduct.gallery || []).map((img, idx) => (
                            <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-[var(--border-color)] cursor-pointer" onClick={() => setEditingProduct({...editingProduct, image_url: img})}>
                              <img src={img || undefined} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              {editingProduct.image_url === img && (
                                <div className="absolute top-0 left-0 p-1 bg-brand-peach text-white text-[9px] sm:text-[10px] font-bold z-10 rounded-br-lg shadow-sm">
                                  Portada
                                </div>
                              )}
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newGallery = (editingProduct.gallery || []).filter((_, i) => i !== idx);
                                  setEditingProduct({...editingProduct, gallery: newGallery});
                                }}
                                className="absolute top-0 right-0 p-1.5 sm:p-1 bg-red-500 text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10 rounded-bl-lg shadow-sm"
                              >
                                <X size={12} />
                              </button>
                              <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] text-center py-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                Seleccionar
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 md:p-8 border-t border-[var(--border-color)] flex flex-col sm:flex-row gap-4 bg-[var(--bg-secondary)]">
                  <button 
                    type="submit" 
                    className="w-full bg-brand-peach text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-brand-peach/20"
                  >
                    <Save size={20} /> Guardar Cambios Finales
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingCategory && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-[var(--bg-primary)] w-full max-w-2xl max-h-[85vh] rounded-[40px] overflow-hidden flex flex-col shadow-2xl border border-[var(--border-color)]"
            >
              <form onSubmit={handleSaveCategory} className="flex flex-col min-h-0 flex-1">
                <div className="p-6 md:p-8 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-primary)] z-10">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-[var(--text-primary)]">{editingCategory.id ? 'Editar' : 'Nueva'} Categoría</h2>
                    <button
                      type="button"
                      onClick={() => handleAITranslate('category')}
                      disabled={aiLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-brand-peach/10 text-brand-peach rounded-full text-xs font-bold uppercase tracking-widest hover:bg-brand-peach/20 transition-all disabled:opacity-50"
                    >
                      <Icons.Languages size={14} />
                      {aiLoading ? 'Traduciendo...' : 'Traducir con IA'}
                    </button>
                  </div>
                  <button type="button" onClick={() => setEditingCategory(null)} className="p-2 hover:bg-[var(--bg-secondary)] rounded-full transition-colors text-[var(--text-primary)]"><X /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar bg-[var(--bg-primary)]">
                  <div>
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Nombre de la categoría *</label>
                    <input 
                      required
                      placeholder="Nombre de la categoría"
                      value={editingCategory.name}
                      onChange={e => setEditingCategory({...editingCategory, name: e.target.value})}
                      className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)] font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Descripción</label>
                    <textarea 
                      placeholder="Descripción"
                      value={editingCategory.description}
                      onChange={e => setEditingCategory({...editingCategory, description: e.target.value})}
                      className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)] min-h-[80px]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Imagen (URL o Subir)</label>
                    <div className="flex flex-col md:flex-row gap-6 items-start">
                      <div className="flex-1 w-full space-y-4">
                        <input 
                          placeholder="URL de la imagen (opcional)"
                          value={editingCategory.image_url}
                          onChange={e => setEditingCategory({...editingCategory, image_url: e.target.value})}
                          className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                        />
                        <div>
                          <input 
                            type="file" 
                            id="category-image-upload"
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                try {
                                  const compressedImage = await compressImage(file);
                                  setEditingCategory({ ...editingCategory, image_url: compressedImage });
                                } catch (error) {
                                  console.error("Error compressing image:", error);
                                  alert("Error al procesar la imagen.");
                                }
                              }
                            }}
                            className="hidden"
                          />
                          <label 
                            htmlFor="category-image-upload"
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs font-bold cursor-pointer hover:bg-brand-peach hover:text-white transition-all border border-[var(--border-color)]"
                          >
                            <ImageIcon size={14} /> Seleccionar Archivo
                          </label>
                        </div>
                        
                        <div className="p-5 bg-[var(--bg-secondary)] rounded-3xl border border-[var(--border-color)]">
                          <p className="text-xs font-bold mb-3 flex items-center gap-2 text-[var(--text-primary)]"><Wand2 size={14} /> IA Image Editor (Gemini)</p>
                          <textarea 
                            value={aiCategoryPrompt}
                            onChange={e => setAiCategoryPrompt(e.target.value)}
                            placeholder="Ej: una imagen minimalista para la categoría de perfumes..."
                            className="w-full bg-[var(--bg-primary)] rounded-2xl p-4 text-sm outline-none mb-3 shadow-sm focus:ring-2 ring-brand-peach/20 transition-all min-h-[80px] text-[var(--text-primary)]"
                          />
                          <button 
                            type="button"
                            onClick={handleCategoryAiEdit}
                            disabled={aiLoading}
                            className="w-full bg-brand-peach text-white py-3 rounded-2xl text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 shadow-lg"
                          >
                            {aiLoading ? 'Generando...' : 'Aplicar IA'}
                          </button>
                          <p className="text-[10px] text-[var(--text-secondary)] mt-3 italic">Nota: Solo funciona con imágenes subidas (base64).</p>
                        </div>
                      </div>
                      
                      <div className="w-full md:w-40 flex flex-col gap-3">
                        <div className="aspect-square bg-[var(--bg-secondary)] rounded-3xl overflow-hidden shadow-inner border-4 border-[var(--border-color)] relative group">
                          {editingCategory.image_url ? (
                            <>
                              <img src={editingCategory.image_url || undefined} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              <div className="absolute inset-x-0 bottom-0 pb-3 pt-8 bg-gradient-to-t from-black/80 to-transparent flex flex-col items-center justify-end gap-2 md:inset-0 md:bg-black/40 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:justify-center transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const gallery = editingCategory.gallery || [];
                                    if (!gallery.includes(editingCategory.image_url)) {
                                      setEditingCategory({ ...editingCategory, gallery: [...gallery, editingCategory.image_url] });
                                      alert('Imagen guardada en la galería');
                                    }
                                  }}
                                  className="bg-white text-brand-dark px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 hover:bg-brand-peach hover:text-white transition-colors"
                                >
                                  <ImagePlus size={12} /> Guardar en Galería
                                </button>
                                {editingCategory.image_url.startsWith('data:image') && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const link = document.createElement('a');
                                      link.href = editingCategory.image_url;
                                      link.download = `sorella-category-${Date.now()}.png`;
                                      link.click();
                                    }}
                                    className="bg-white text-brand-dark px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 hover:bg-brand-peach hover:text-white transition-colors"
                                  >
                                    <Save size={12} /> Descargar
                                  </button>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-secondary)] gap-2">
                              <ImageIcon size={32} />
                              <span className="text-[10px] font-bold uppercase">Sin imagen</span>
                            </div>
                          )}
                        </div>

                        {/* Gallery Preview */}
                        <div className="grid grid-cols-3 gap-2">
                          {(editingCategory.gallery || []).map((img, idx) => (
                            <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-[var(--border-color)] cursor-pointer" onClick={() => setEditingCategory({...editingCategory, image_url: img})}>
                              <img src={img || undefined} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newGallery = (editingCategory.gallery || []).filter((_, i) => i !== idx);
                                  setEditingCategory({...editingCategory, gallery: newGallery});
                                }}
                                className="absolute top-0 right-0 p-1.5 sm:p-1 bg-red-500 text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10 rounded-bl-lg shadow-sm"
                              >
                                <X size={12} />
                              </button>
                              <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] text-center py-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                Seleccionar
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 md:p-8 border-t border-[var(--border-color)] flex flex-col sm:flex-row gap-4 bg-[var(--bg-secondary)]">
                  <button 
                    type="submit" 
                    className="w-full bg-brand-peach text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-brand-peach/20"
                  >
                    <Save size={20} /> Guardar Cambios Finales
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Coupon Edit Modal */}
      <AnimatePresence>
        {editingCoupon && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-[var(--bg-primary)] w-full max-w-2xl max-h-[85vh] rounded-[40px] overflow-hidden flex flex-col shadow-2xl border border-[var(--border-color)]"
            >
              <form onSubmit={handleSaveCoupon} className="flex flex-col min-h-0 flex-1">
                <div className="p-6 md:p-8 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-primary)] z-10">
                  <h2 className="text-2xl font-bold text-[var(--text-primary)]">{editingCoupon.id ? t.admin.coupons.edit : t.admin.coupons.new}</h2>
                  <button type="button" onClick={() => setEditingCoupon(null)} className="p-2 hover:bg-[var(--bg-secondary)] rounded-full transition-colors text-[var(--text-primary)]"><X /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar bg-[var(--bg-primary)]">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.coupons.code}</label>
                      <input 
                        required
                        value={editingCoupon.code}
                        onChange={e => setEditingCoupon({...editingCoupon, code: e.target.value.toUpperCase()})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)] font-mono"
                        placeholder={t.admin.coupons.codePlaceholder}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.coupons.discount}</label>
                      <input 
                        required
                        type="number"
                        min="1"
                        max="100"
                        value={editingCoupon.discount_percentage}
                        onChange={e => setEditingCoupon({...editingCoupon, discount_percentage: Number(e.target.value)})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.coupons.validFrom}</label>
                      <input 
                        required
                        type="date"
                        value={editingCoupon.valid_from}
                        onChange={e => setEditingCoupon({...editingCoupon, valid_from: e.target.value})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.coupons.validUntil}</label>
                      <input 
                        required
                        type="date"
                        value={editingCoupon.valid_until}
                        onChange={e => setEditingCoupon({...editingCoupon, valid_until: e.target.value})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.coupons.minAmount} ($)</label>
                      <input 
                        type="number"
                        value={editingCoupon.min_purchase_amount || 0}
                        onChange={e => setEditingCoupon({...editingCoupon, min_purchase_amount: Number(e.target.value)})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.coupons.limit}</label>
                      <input 
                        type="number"
                        value={editingCoupon.usage_limit || ''}
                        onChange={e => setEditingCoupon({...editingCoupon, usage_limit: e.target.value ? Number(e.target.value) : undefined})}
                        className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach transition-colors bg-transparent text-[var(--text-primary)]"
                        placeholder={t.admin.coupons.unlimited}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.coupons.description}</label>
                    <textarea 
                      value={editingCoupon.description || ''}
                      onChange={e => setEditingCoupon({...editingCoupon, description: e.target.value})}
                      className="w-full bg-[var(--bg-secondary)] rounded-2xl p-4 text-sm outline-none border border-[var(--border-color)] focus:ring-2 ring-brand-peach/20 transition-all min-h-[80px] text-[var(--text-primary)]"
                      placeholder={t.admin.coupons.descriptionPlaceholder}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.admin.coupons.applicableCategories}</label>
                    <div className="flex flex-wrap gap-2 p-4 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)]">
                      {categories.map(cat => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            const currentCats = editingCoupon.applicable_categories || [];
                            const newCats = currentCats.includes(cat.name)
                              ? currentCats.filter(c => c !== cat.name)
                              : [...currentCats, cat.name];
                            setEditingCoupon({...editingCoupon, applicable_categories: newCats});
                          }}
                          className={`px-4 py-2 rounded-full text-xs font-bold transition-all border ${
                            (editingCoupon.applicable_categories || []).includes(cat.name)
                              ? 'bg-brand-peach text-white border-brand-peach'
                              : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-brand-peach/50'
                          }`}
                        >
                          {cat.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setEditingCoupon({...editingCoupon, applicable_categories: undefined})}
                        className={`px-4 py-2 rounded-full text-xs font-bold transition-all border ${
                          !editingCoupon.applicable_categories
                            ? 'bg-brand-dark text-white border-brand-dark'
                            : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-color)]'
                        }`}
                      >
                        {t.admin.coupons.allCategories}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-4 bg-brand-peach/5 rounded-2xl border border-brand-peach/20">
                    <input 
                      type="checkbox"
                      id="coupon-active"
                      checked={editingCoupon.active}
                      onChange={e => setEditingCoupon({...editingCoupon, active: e.target.checked})}
                      className="w-5 h-5 rounded border-brand-peach text-brand-peach focus:ring-brand-peach"
                    />
                    <label htmlFor="coupon-active" className="text-sm font-bold text-brand-peach cursor-pointer">{t.admin.coupons.couponActive}</label>
                  </div>
                </div>

                <div className="p-6 md:p-8 border-t border-[var(--border-color)] bg-[var(--bg-primary)] flex gap-4">
                  <button 
                    type="submit"
                    className="flex-1 bg-brand-peach text-white py-4 rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg shadow-brand-peach/20"
                  >
                    {editingCoupon.id ? t.admin.coupons.update : t.admin.coupons.create} {t.admin.coupons.code}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setEditingCoupon(null)}
                    className="px-8 py-4 rounded-2xl font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-all"
                  >
                    {t.admin.coupons.cancel}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingBanner && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-[var(--bg-primary)] w-full max-w-xl rounded-[40px] overflow-hidden p-8 max-h-[90vh] overflow-y-auto border border-[var(--border-color)] shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-[var(--text-primary)]">{editingBanner.id ? 'Editar' : 'Nuevo'} Banner</h2>
                <button type="button" onClick={() => setEditingBanner(null)} className="p-2 hover:bg-[var(--bg-secondary)] rounded-full transition-colors text-[var(--text-primary)]"><X /></button>
              </div>
              <form onSubmit={handleSaveBanner} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)]">Título</label>
                  <input 
                    placeholder="Título"
                    value={editingBanner.title}
                    onChange={e => setEditingBanner({...editingBanner, title: e.target.value})}
                    className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)]">Subtítulo</label>
                  <input 
                    placeholder="Subtítulo"
                    value={editingBanner.subtitle}
                    onChange={e => setEditingBanner({...editingBanner, subtitle: e.target.value})}
                    className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)]">Texto del botón</label>
                    <input 
                      placeholder="Texto del botón"
                      value={editingBanner.button_text}
                      onChange={e => setEditingBanner({...editingBanner, button_text: e.target.value})}
                      className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)]">Link</label>
                    <select 
                      value={editingBanner.button_link}
                      onChange={e => setEditingBanner({...editingBanner, button_link: e.target.value})}
                      className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                    >
                      <option value="" className="bg-[var(--bg-primary)] text-[var(--text-primary)]">Sin link</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.name} className="bg-[var(--bg-primary)] text-[var(--text-primary)]">{cat.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)]">Orden</label>
                  <input 
                    type="number"
                    placeholder="0"
                    value={editingBanner.order_index}
                    onChange={e => setEditingBanner({...editingBanner, order_index: parseInt(e.target.value) || 0})}
                    className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)]">URL de la imagen</label>
                  <div className="flex flex-col gap-4">
                    <input 
                      required
                      placeholder="URL de la imagen"
                      value={editingBanner.image_url}
                      onChange={e => setEditingBanner({...editingBanner, image_url: e.target.value})}
                      className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                    />
                    <div>
                      <input 
                        type="file" 
                        id="banner-image-upload"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            try {
                              const compressedImage = await compressImage(file);
                              setEditingBanner({ ...editingBanner, image_url: compressedImage });
                            } catch (error) {
                              console.error("Error compressing image:", error);
                              alert("Error al procesar la imagen");
                            }
                          }
                        }}
                        className="hidden"
                      />
                      <label 
                        htmlFor="banner-image-upload"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl cursor-pointer transition-colors text-sm font-medium text-[var(--text-primary)]"
                      >
                        <Upload size={16} /> Subir Imagen
                      </label>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)]">Estilo del Banner</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'split-right', label: 'Texto Izq / Foto Der' },
                      { id: 'split-left', label: 'Foto Izq / Texto Der' },
                      { id: 'full-width', label: 'Foto Completa' }
                    ].map(styleOption => (
                      <button
                        key={styleOption.id}
                        type="button"
                        onClick={() => setEditingBanner({...editingBanner, style: styleOption.id as any})}
                        className={`p-2 text-xs font-bold rounded-xl border transition-all ${
                          (editingBanner.style || 'full-width') === styleOption.id 
                            ? 'border-brand-peach bg-brand-peach/10 text-brand-peach' 
                            : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-brand-peach/50'
                        }`}
                      >
                        {styleOption.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)]">Vista Previa</label>
                  <div className="w-full aspect-video rounded-2xl overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)] relative text-[8px] sm:text-[10px]">
                    {(() => {
                      const style = editingBanner.style || 'full-width';
                      const titleParts = editingBanner.title.split(' ');
                      const firstPart = titleParts.slice(0, Math.ceil(titleParts.length / 2)).join(' ');
                      const secondPart = titleParts.slice(Math.ceil(titleParts.length / 2)).join(' ');

                      if (style === 'split-right' || style === 'split-left') {
                        const isRight = style === 'split-right';
                        return (
                          <div className="w-full h-full flex items-center p-4 gap-4">
                            <div className={`flex flex-col justify-center flex-1 ${isRight ? 'order-1' : 'order-2'}`}>
                              <h1 className="text-2xl font-black tracking-tighter leading-[0.9] mb-2 uppercase break-words">
                                <span className="text-[var(--text-primary)] block">{firstPart || 'TÍTULO'}</span>
                                {secondPart && <span className="text-brand-peach block opacity-80">{secondPart}</span>}
                              </h1>
                              <p className="text-[var(--text-secondary)] mb-2 line-clamp-2">
                                {editingBanner.subtitle || 'Subtítulo del banner'}
                              </p>
                              <button className="bg-brand-peach/40 text-brand-dark px-3 py-1.5 rounded-full font-medium flex items-center gap-1 w-fit text-[8px]">
                                {editingBanner.button_text || 'Botón'} <ArrowRight size={10} />
                              </button>
                            </div>
                            <div className={`flex-1 aspect-square rounded-2xl overflow-hidden bg-[var(--bg-secondary)] ${isRight ? 'order-2' : 'order-1'}`}>
                              {editingBanner.image_url ? (
                                <img src={editingBanner.image_url} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">Sin imagen</div>
                              )}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="w-full h-full relative">
                          <div className="absolute inset-0 bg-[var(--bg-secondary)]">
                            {editingBanner.image_url && <img src={editingBanner.image_url} className="w-full h-full object-cover" />}
                            <div className="absolute inset-0 bg-black/30" />
                          </div>
                          <div className="relative h-full flex flex-col items-center justify-center text-center text-white p-4">
                            <h1 className="text-2xl font-bold tracking-tighter mb-1 uppercase">{editingBanner.title || 'TÍTULO'}</h1>
                            <p className="font-light mb-2 line-clamp-2">{editingBanner.subtitle || 'Subtítulo'}</p>
                            <button className="bg-white text-brand-dark px-3 py-1.5 rounded-full font-bold uppercase tracking-widest text-[8px]">
                              {editingBanner.button_text || 'Botón'}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex items-center gap-2 py-2">
                  <input 
                    type="checkbox"
                    id="is_fixed"
                    checked={editingBanner.is_fixed}
                    onChange={e => setEditingBanner({...editingBanner, is_fixed: e.target.checked})}
                    className="accent-brand-peach"
                  />
                  <label htmlFor="is_fixed" className="text-sm font-medium text-[var(--text-primary)]">Efecto Parallax (Fondo Fijo)</label>
                </div>
                <div className="flex gap-2 pt-4">
                  <button type="submit" className="flex-1 bg-brand-peach text-white py-4 rounded-2xl font-bold hover:opacity-90 transition-all shadow-xl shadow-brand-peach/20">Guardar</button>
                  <button type="button" onClick={() => setEditingBanner(null)} className="flex-1 bg-[var(--bg-secondary)] py-4 rounded-2xl font-bold text-[var(--text-primary)] hover:opacity-80 transition-colors">Cancelar</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
        </>
      } />
      <Route path="/product/:id" element={<ProductPage products={products} filters={filters} t={t} onAddToCart={addToCart} onWishlistToggle={toggleWishlist} wishlist={wishlist} />} />
      <Route path="/wishlist" element={<WishlistPage products={products} t={t} onAddToCart={addToCart} onWishlistToggle={toggleWishlist} wishlist={wishlist} />} />
      <Route path="/checkout" element={<CheckoutPage cart={cart} user={user} t={t} apiStatus={apiStatus} settings={settings} coupons={coupons} filters={filters} onOrderSuccess={() => setCart([])} />} />
      <Route path="/success" element={<SuccessPage t={t} />} />
      <Route path="/terminos" element={<LegalPage title="Términos y Condiciones" t={t} />} />
      <Route path="/privacidad" element={<LegalPage title="Política de Privacidad" t={t} />} />
      <Route path="/envios" element={<LegalPage title="Política de Envíos" t={t} />} />
    </Routes>

    <footer className="bg-[var(--bg-secondary)] text-[var(--text-primary)] py-20 px-6 border-t border-[var(--border-color)]">
      <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-12">
        <div className="col-span-2">
          <h2 className="text-4xl font-bold tracking-tighter mb-6">{t.footer.about}</h2>
          <p className="text-[var(--text-secondary)] max-w-md leading-relaxed">
            {t.footer.description}
          </p>
        </div>
        <div>
          <h4 className="font-bold mb-6">{t.footer.links}</h4>
          <ul className="space-y-4 text-[var(--text-secondary)]">
            <li><button onClick={() => { navigate('/catalogo'); setCategoryFilter('Todos'); }} className="hover:text-brand-peach text-left transition-colors">{t.nav.catalog}</button></li>
            <li><button onClick={() => { navigate('/catalogo'); }} className="hover:text-brand-peach text-left transition-colors">{t.nav.categories}</button></li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold mb-6">Legal</h4>
          <ul className="space-y-4 text-[var(--text-secondary)]">
            <li><button onClick={() => navigate('/terminos')} className="hover:text-brand-peach text-left transition-colors">Términos y Condiciones</button></li>
            <li><button onClick={() => navigate('/privacidad')} className="hover:text-brand-peach text-left transition-colors">Política de Privacidad</button></li>
            <li><button onClick={() => navigate('/envios')} className="hover:text-brand-peach text-left transition-colors">Política de Envíos</button></li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold mb-6">{t.footer.contact}</h4>
          <ul className="space-y-4 text-[var(--text-secondary)]">
            <li>info@sorella.com</li>
            <li>+54 11 3509 2612</li>
            <li>Buenos Aires, AR</li>
          </ul>
        </div>
      </div>
      <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-[var(--border-color)] text-center text-[var(--text-secondary)] text-sm">
        © 2026 {t.footer.about}. {t.footer.rights}
      </div>
    </footer>

    <ChatBot products={products} orders={orders} settings={settings} t={t} />
      </div>
    </div>
  );
}

const LegalPage = ({ title, t }: { title: string, t: any }) => {
  const navigate = useNavigate();
  
  const getContent = () => {
    switch(title) {
      case 'Términos y Condiciones':
        return (
          <div className="space-y-6 text-[var(--text-secondary)] leading-relaxed">
            <p>Bienvenido a Sorella. Al acceder y utilizar este sitio web, usted acepta cumplir y estar sujeto a los siguientes términos y condiciones de uso.</p>
            
            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">1. Uso del Sitio</h3>
              <p>El contenido de las páginas de este sitio web es para su información general y uso exclusivo. Está sujeto a cambios sin previo aviso.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">2. Comunicaciones y Marketing</h3>
              <p>Al proporcionar su número de teléfono de WhatsApp y/o correo electrónico, usted autoriza expresamente a Sorella Indumentaria a enviarle comunicaciones relacionadas con sus compras, información de seguimiento de pedidos, así como mensajes promocionales, ofertas exclusivas y novedades de nuestra tienda. Usted puede revocar este consentimiento en cualquier momento solicitándolo por nuestros canales oficiales.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">3. Privacidad y Datos</h3>
              <p>Su uso de este sitio también está regido por nuestra Política de Privacidad. Nos comprometemos a proteger su información personal y utilizarla únicamente para procesar sus pedidos, mejorar su experiencia y mantenerlo informado según lo aceptado en el punto anterior.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">3. Propiedad Intelectual</h3>
              <p>Este sitio web contiene material que es propiedad nuestra o está licenciado para nosotros. Este material incluye, pero no se limita a, el diseño, la disposición, el aspecto, la apariencia y los gráficos.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">4. Limitación de Responsabilidad</h3>
              <p>Sorella no será responsable por cualquier daño indirecto, incidental o consecuente que surja del uso de nuestros productos o del sitio web.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">5. Envíos y Entregas</h3>
              <p>Los costos de envío son estimativos y pueden variar según la zona y el peso del pedido. La coordinación final se realizará vía WhatsApp una vez confirmada la compra.</p>
            </section>
          </div>
        );
      case 'Política de Privacidad':
        return (
          <div className="space-y-6 text-[var(--text-secondary)] leading-relaxed">
            <p>En Sorella, valoramos su privacidad. Esta política describe cómo recopilamos, usamos y protegemos su información personal.</p>
            
            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">Información que Recopilamos</h3>
              <p>Recopilamos información cuando se registra en nuestro sitio, realiza un pedido o se suscribe a nuestro boletín. Esto incluye su nombre, dirección de correo electrónico, dirección de envío y número de teléfono.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">Uso de la Información</h3>
              <p>La información que recopilamos se utiliza para procesar transacciones, mejorar nuestro servicio al cliente y enviar correos electrónicos periódicos sobre sus pedidos o promociones.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">Protección de Datos</h3>
              <p>Implementamos una variedad de medidas de seguridad para mantener la seguridad de su información personal cuando realiza un pedido o ingresa, envía o accede a su información personal.</p>
            </section>
          </div>
        );
      case 'Política de Envíos':
        return (
          <div className="space-y-6 text-[var(--text-secondary)] leading-relaxed">
            <p>Nuestra política de envíos está diseñada para asegurar que sus productos lleguen de manera segura y eficiente.</p>
            
            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">Zonas de Entrega</h3>
              <p>Realizamos envíos a todo el país. Contamos con tarifas diferenciadas para CABA, GBA y el resto del territorio nacional.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">Tiempos de Entrega</h3>
              <p>Los pedidos suelen procesarse en 24-48 horas hábiles. El tiempo de entrega final dependerá del método de envío seleccionado y la ubicación del destinatario.</p>
            </section>

            <section>
              <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">Coordinación</h3>
              <p>Es fundamental proporcionar un número de teléfono válido, ya que la coordinación final de la entrega se realiza exclusivamente por WhatsApp.</p>
            </section>
          </div>
        );
      default:
        return <p>Contenido no disponible.</p>;
    }
  };

  return (
    <div className="pt-32 pb-20 px-6 max-w-4xl mx-auto">
      <button 
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-brand-peach mb-8 hover:underline font-medium"
      >
        <ArrowRight className="rotate-180" size={16} /> Volver
      </button>
      <h1 className="text-4xl font-bold mb-12 tracking-tighter text-[var(--text-primary)]">{title}</h1>
      <div className="bg-[var(--bg-primary)] p-8 md:p-12 rounded-[40px] border border-[var(--border-color)] shadow-sm">
        {getContent()}
      </div>
    </div>
  );
};

const SuccessPage = ({ t }: { t: any }) => {
  const navigate = useNavigate();
  return (
    <div className="pt-32 pb-20 px-6 text-center max-w-2xl mx-auto">
      <div className="w-20 h-20 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-8">
        <ShoppingBag size={40} />
      </div>
      <h1 className="text-4xl font-bold mb-4 tracking-tighter text-[var(--text-primary)]">{t.checkout.successTitle}</h1>
      <p className="text-[var(--text-secondary)] mb-12">{t.checkout.successMessage}</p>
      <button 
        onClick={() => navigate('/')}
        className="bg-brand-peach text-white px-12 py-4 rounded-full font-bold shadow-lg shadow-brand-peach/20 hover:scale-105 transition-transform"
      >
        {t.checkout.backToCatalog}
      </button>
    </div>
  );
};

const CheckoutPage = ({ cart, user, t, apiStatus, settings, coupons, filters, onOrderSuccess }: { cart: CartItem[], user: User | null, t: any, apiStatus: any, settings: Settings | null, coupons: Coupon[], filters?: Filter[], onOrderSuccess: () => void }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [shippingMethod, setShippingMethod] = useState<'Recoger pedido' | 'Envio a domicilio'>('Recoger pedido');
  const [shippingAck, setShippingAck] = useState(false);
  const [shippingRatesOpen, setShippingRatesOpen] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [couponError, setCouponError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    notes: '',
    receiverDni: '',
    receiverFirstName: '',
    receiverLastName: ''
  });

  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        name: user.displayName || '',
        email: user.email || ''
      }));
      getUserProfile(user.uid).then(profile => {
        if (profile) {
          setFormData(prev => ({
            ...prev,
            phone: profile.phone || prev.phone,
            address: profile.address || prev.address,
            city: profile.city || prev.city
          }));
        }
      });
    }
  }, [user]);

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discountAmount = appliedCoupon ? (subtotal * appliedCoupon.discount_percentage / 100) : 0;
  const total = subtotal - discountAmount;

  const handleApplyCoupon = () => {
    setCouponError('');
    const coupon = coupons.find(c => c.code.toUpperCase() === couponCode.toUpperCase());
    
    if (!coupon) {
      setCouponError(t.checkout.coupon.invalid);
      return;
    }
    
    if (!coupon.active) {
      setCouponError(t.checkout.coupon.invalid);
      return;
    }

    const now = new Date().toISOString().split('T')[0];
    if (now < coupon.valid_from || now > coupon.valid_until) {
      setCouponError(t.checkout.coupon.expired);
      return;
    }

    if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
      setCouponError(t.checkout.coupon.limitReached);
      return;
    }

    if (coupon.min_purchase_amount && subtotal < coupon.min_purchase_amount) {
      setCouponError(t.checkout.coupon.minAmount.replace('{amount}', coupon.min_purchase_amount.toString()));
      return;
    }

    // Check applicable categories if any
    if (coupon.applicable_categories && coupon.applicable_categories.length > 0) {
      const hasApplicableProduct = cart.some(item => {
        const productCats = item.categories || [item.category];
        return productCats.some(cat => coupon.applicable_categories?.includes(cat));
      });
      
      if (!hasApplicableProduct) {
        setCouponError(t.checkout.coupon.notApplicable);
        return;
      }
    }

    setAppliedCoupon(coupon);
    setCouponCode('');
    alert(t.checkout.coupon.success);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (shippingMethod === 'Envio a domicilio' && !shippingAck) {
      alert(t.checkout.shippingAckRequired);
      return;
    }

    setLoading(true);
    try {
      const customerEmail = formData.email;
      const customerName = formData.name;

      if (!customerEmail || !customerName || !formData.phone) {
        alert("Por favor completa todos los campos obligatorios");
        setLoading(false);
        return;
      }

      const itemsWithFilterNames = cart.map(item => {
        if (!item.selectedDynamicFilters) return item;
        const mappedFilters: Record<string, string> = {};
        Object.entries(item.selectedDynamicFilters).forEach(([key, value]) => {
          const filterName = filters?.find(f => f.id === key)?.name || key;
          mappedFilters[filterName] = value;
        });
        return { ...item, selectedDynamicFilters: mappedFilters };
      });

      const orderData = {
        order_number: `ORD-${Date.now()}`,
        customer_email: customerEmail,
        customer_name: customerName,
        customer_phone: formData.phone,
        shipping_address: shippingMethod === 'Envio a domicilio' ? `${formData.address}, ${formData.city}` : 'Retiro en local',
        shipping_method: shippingMethod,
        receiver_dni: formData.receiverDni,
        receiver_first_name: formData.receiverFirstName,
        receiver_last_name: formData.receiverLastName,
        total,
        items: itemsWithFilterNames,
        status: apiStatus.mercadopago ? 'Pendiente de pago' : 'En proceso'
      };

      // Create buyer user if not logged in
      if (!user) {
        console.log("Creating buyer record for guest...");
        try {
          await createBuyerUser({
            displayName: customerName,
            email: customerEmail,
            phone: formData.phone,
            address: formData.address,
            city: formData.city
          });
        } catch (e) {
          console.error("Error creating buyer record:", e);
          // Continue even if buyer creation fails
        }
      }

      console.log("Creating order in Firestore...");
      await createOrder(orderData);
      
      // If Mercado Pago is configured, create preference
      if (apiStatus.mercadopago) {
        console.log("Mercado Pago is active. Creating preference...");
        try {
          const mpRes = await fetch('/api/checkout/mercadopago', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: cart, orderData })
          });
          
          const responseText = await mpRes.text();
          console.log("MP Server Response:", responseText);
          
          let mpData;
          try {
            mpData = JSON.parse(responseText);
          } catch (e) {
            console.error("Non-JSON response from server:", responseText);
            const preview = responseText.substring(0, 200);
            throw new Error(`El servidor devolvió una respuesta no válida (posiblemente HTML). Respuesta: ${preview}...`);
          }
          
          if (!mpRes.ok) {
            throw new Error(mpData.error || `Error del servidor (${mpRes.status}): ${responseText.substring(0, 50)}`);
          }

          console.log("MP Preference created successfully:", mpData);
          
          if (mpData.init_point) {
            setPaymentLink(mpData.init_point);
            console.log("Redirecting to Mercado Pago init_point:", mpData.init_point);
            // Try to open in new tab first to avoid iframe issues
            try {
              const win = window.open(mpData.init_point, '_blank');
              if (!win || win.closed || typeof win.closed === 'undefined') {
                console.warn("Pop-up blocked, trying top-level redirect");
                try {
                  window.top!.location.href = mpData.init_point;
                } catch (e) {
                  console.warn("Top-level redirect blocked, using iframe redirect");
                  window.location.href = mpData.init_point;
                }
              }
            } catch (e) {
              console.error("window.open failed, using fallback redirect", e);
              window.location.href = mpData.init_point;
            }
            return;
          } else {
            throw new Error("No se recibió el punto de inicio (init_point) de Mercado Pago");
          }
        } catch (e: any) {
          console.error("Mercado Pago Error:", e);
          const msg = e instanceof Error ? e.message : (typeof e === 'string' ? e : JSON.stringify(e));
          alert(`Error con Mercado Pago: ${msg}. El pedido se guardó pero no pudimos redirigirte al pago. Por favor contacta con soporte.`);
        }
      } else {
        console.warn("Mercado Pago is NOT active. Skipping payment redirect.");
        // Send email notifications via backend for non-MP orders
        try {
          await fetch('/api/notify-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
          });
        } catch (e) {
          console.error("Error sending notification:", e);
        }
      }

      onOrderSuccess();
      navigate('/success');
    } catch (err: any) {
      console.error("General Checkout Error:", err);
      const msg = err instanceof Error ? err.message : (typeof err === 'string' ? err : JSON.stringify(err));
      alert(`Hubo un error al procesar tu pedido: ${msg || 'Error desconocido'}. Por favor intenta de nuevo.`);
    } finally {
      setLoading(false);
    }
  };

  if (cart.length === 0) {
    return (
      <div className="pt-32 pb-20 px-6 text-center">
        <h2 className="text-2xl font-bold mb-4 text-[var(--text-primary)]">{t.checkout.empty}</h2>
        <button onClick={() => navigate('/')} className="bg-brand-peach text-brand-dark px-8 py-3 rounded-full font-bold hover:scale-105 transition-transform">
          {t.checkout.backToCatalog}
        </button>
      </div>
    );
  }

  return (
    <div className="pt-32 pb-20 px-6 max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold mb-12 tracking-tighter text-[var(--text-primary)]">{t.checkout.title}</h1>
      <div className="grid md:grid-cols-2 gap-12">
        <div className="space-y-8">
          <section className="bg-[var(--bg-primary)] p-8 rounded-[40px] border border-[var(--border-color)] shadow-sm">
            <h2 className="text-xl font-bold mb-6 text-[var(--text-primary)]">{t.checkout.shippingMethod}</h2>
            <div className="grid grid-cols-2 gap-4 mb-8">
              <button 
                onClick={() => setShippingMethod('Recoger pedido')}
                className={`p-4 rounded-2xl border-2 transition-all ${shippingMethod === 'Recoger pedido' ? 'border-brand-peach bg-brand-peach/5' : 'border-[var(--border-color)] hover:border-brand-peach/30'}`}
              >
                <div className="font-bold text-sm mb-1 text-[var(--text-primary)]">{t.checkout.pickup}</div>
                <div className="text-[10px] text-[var(--text-secondary)] uppercase">{t.checkout.free}</div>
              </button>
              <button 
                onClick={() => setShippingMethod('Envio a domicilio')}
                className={`p-4 rounded-2xl border-2 transition-all ${shippingMethod === 'Envio a domicilio' ? 'border-brand-peach bg-brand-peach/5' : 'border-[var(--border-color)] hover:border-brand-peach/30'}`}
              >
                <div className="font-bold text-sm mb-1 text-[var(--text-primary)]">{t.checkout.delivery}</div>
                <div className="text-[10px] text-[var(--text-secondary)] uppercase">{t.checkout.coordinate}</div>
              </button>
            </div>

            <h2 className="text-xl font-bold mb-6 text-[var(--text-primary)]">{t.checkout.contactInfo}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Nombre Completo</label>
                <input 
                  required
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                  placeholder="Tu nombre"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Email</label>
                <input 
                  required
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                  placeholder="tu@email.com"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.checkout.phone}</label>
                <input 
                  required
                  value={formData.phone}
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                  placeholder="+54 ..."
                />
              </div>

              <h3 className="text-lg font-bold mt-8 mb-4 text-[var(--text-primary)]">Datos de quien {shippingMethod === 'Recoger pedido' ? 'retira' : 'recibe'}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Nombre</label>
                  <input 
                    required
                    value={formData.receiverFirstName}
                    onChange={e => setFormData({...formData, receiverFirstName: e.target.value})}
                    className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                    placeholder="Nombre"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">Apellido</label>
                  <input 
                    required
                    value={formData.receiverLastName}
                    onChange={e => setFormData({...formData, receiverLastName: e.target.value})}
                    className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                    placeholder="Apellido"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">D.N.I.</label>
                <input 
                  required
                  value={formData.receiverDni}
                  onChange={e => setFormData({...formData, receiverDni: e.target.value})}
                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                  placeholder="Número de documento"
                />
              </div>
              
              {shippingMethod === 'Envio a domicilio' && (
                <>
                  <div>
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.checkout.address}</label>
                    <input 
                      required
                      value={formData.address}
                      onChange={e => setFormData({...formData, address: e.target.value})}
                      className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.checkout.city}</label>
                    <input 
                      required
                      value={formData.city}
                      onChange={e => setFormData({...formData, city: e.target.value})}
                      className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                    />
                  </div>
                  <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] overflow-hidden">
                    <button 
                      type="button"
                      onClick={() => setShippingRatesOpen(!shippingRatesOpen)}
                      className="w-full flex items-center justify-between p-4 text-left hover:bg-[var(--bg-primary)] transition-colors"
                    >
                      <span className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                        <Package size={16} /> Tarifas de Envío Estimadas
                      </span>
                      <ChevronDown size={16} className={`text-[var(--text-secondary)] transition-transform ${shippingRatesOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {shippingRatesOpen && (
                      <div className="p-4 border-t border-[var(--border-color)] text-xs text-[var(--text-secondary)] space-y-3 bg-[var(--bg-primary)]">
                        <p className="font-bold text-brand-peach">CABA y cercanías (GBA):</p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>A sucursal: {settings?.shipping_caba_sucursal || '$4.500 - $6.200'}</li>
                          <li>A domicilio: {settings?.shipping_caba_domicilio || '$6.000 - $8.500'}</li>
                        </ul>
                        <p className="font-bold text-brand-peach mt-3">Envíos Nacionales (Provincia a Provincia o CABA a Interior):</p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>A sucursal (ej: Córdoba, Rosario): {settings?.shipping_nacional_sucursal || '$7.500 - $11.000'}</li>
                          <li>A domicilio (ej: Patagonia o NOA): {settings?.shipping_nacional_domicilio || '$11.000 - $18.000'}</li>
                        </ul>
                        <div className="mt-4 p-3 bg-brand-peach/10 rounded-xl border border-brand-peach/20 text-[10px] leading-relaxed">
                          <strong>Aviso importante:</strong> Los valores mostrados son estimativos y pueden variar según el peso, dimensiones del paquete y actualizaciones de la empresa de transporte. Al seleccionar envío a domicilio, aceptas que el costo final será confirmado y coordinado por WhatsApp luego de la compra.
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-start gap-3 p-4 bg-brand-peach/5 rounded-2xl border border-brand-peach/10">
                    <input 
                      type="checkbox" 
                      id="shippingAck" 
                      checked={shippingAck}
                      onChange={e => setShippingAck(e.target.checked)}
                      className="mt-1 accent-brand-peach"
                    />
                    <label htmlFor="shippingAck" className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      Entiendo que el costo de envío es estimativo, no está incluido en el total, y acepto que el valor final se coordinará por WhatsApp luego de la compra.
                    </label>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">{t.checkout.notes}</label>
                <textarea 
                  value={formData.notes}
                  onChange={e => setFormData({...formData, notes: e.target.value})}
                  className="w-full border-b border-[var(--border-color)] py-2 outline-none focus:border-brand-peach bg-transparent text-[var(--text-primary)]"
                  placeholder={t.checkout.notesPlaceholder}
                />
              </div>
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-brand-peach text-brand-dark py-4 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-xl shadow-brand-peach/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? t.checkout.processing : <><ShoppingBag size={20} /> {t.checkout.payWithMercadoPago}</>}
              </button>
              {paymentLink && loading && (
                <div className="mt-4 text-center">
                  <a 
                    href={paymentLink} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-sm text-brand-peach underline font-bold"
                  >
                    ¿No fuiste redirigido? Haz clic aquí para pagar
                  </a>
                </div>
              )}
            </form>
          </section>
        </div>

        <div className="space-y-6">
          <div className="bg-[var(--bg-secondary)] p-8 rounded-[40px] border border-[var(--border-color)]">
            <h2 className="text-xl font-bold mb-6 text-[var(--text-primary)]">{t.checkout.summary}</h2>
            <div className="space-y-4 mb-6">
              {cart.map(item => (
                <div key={item.cartItemId || item.id} className="flex flex-col text-sm text-[var(--text-primary)]">
                  <div className="flex justify-between">
                    <span>{item.name} x{item.quantity}</span>
                    <span className="font-bold">${(item.price * item.quantity).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] mt-1 space-y-0.5">
                    {item.selectedSize && <p>Talle: {item.selectedSize}</p>}
                    {item.selectedColor && (
                      <div className="flex items-center gap-1">
                        <span>Color:</span>
                        <div className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: item.selectedColor }} />
                      </div>
                    )}
                    {item.selectedDynamicFilters && Object.entries(item.selectedDynamicFilters).map(([key, value]) => {
                      const filterName = filters?.find(f => f.id === key)?.name || key;
                      return <p key={key}>{filterName}: {value}</p>;
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-6 space-y-4">
              <h3 className="font-bold text-sm text-[var(--text-primary)]">{t.checkout.coupon.title}</h3>
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase())}
                  placeholder={t.checkout.coupon.placeholder}
                  className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-4 py-2 text-xs outline-none focus:ring-2 ring-brand-peach/20 transition-all text-[var(--text-primary)]"
                />
                <button 
                  onClick={handleApplyCoupon}
                  className="bg-brand-dark text-white px-4 py-2 rounded-xl font-bold text-xs hover:opacity-90 transition-all"
                >
                  {t.checkout.coupon.apply}
                </button>
              </div>
              {couponError && <p className="text-red-500 text-[10px] font-medium px-1">{couponError}</p>}
              {appliedCoupon && (
                <div className="flex items-center justify-between bg-green-500/10 p-2 rounded-xl border border-green-500/20">
                  <div className="flex items-center gap-2 text-green-600">
                    <Tag size={12} />
                    <span className="text-[10px] font-bold">{t.checkout.coupon.applied.replace('{code}', appliedCoupon.code)}</span>
                  </div>
                  <button 
                    onClick={() => setAppliedCoupon(null)}
                    className="text-green-600 hover:text-green-700 p-1"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border-color)] pt-4 space-y-2">
              <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                <span>Subtotal</span>
                <span>${subtotal.toLocaleString()}</span>
              </div>
              {appliedCoupon && (
                <div className="flex justify-between text-sm text-green-600 font-medium">
                  <span>Descuento ({appliedCoupon.discount_percentage}%)</span>
                  <span>-${discountAmount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-[var(--text-secondary)]">
                <span>{t.checkout.shipping}</span>
                <span>{shippingMethod === 'Recoger pedido' ? t.checkout.free : t.checkout.coordinate}</span>
              </div>
              <div className="pt-4 flex justify-between items-center">
                <span className="font-bold text-lg text-[var(--text-primary)]">{t.cart.total}</span>
                <span className="text-2xl font-bold text-brand-peach">${total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
