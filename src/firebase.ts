import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  updateProfile 
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, deleteDoc, updateDoc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();

const handleFirestoreError = (error: any, operation: string, path: string) => {
  const errInfo = {
    error: error.message || String(error),
    operation,
    path,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    }
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Check if user profile exists, if not create it
    const userRef = doc(db, 'users', user.uid);
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (err) {
      handleFirestoreError(err, 'get', `users/${user.uid}`);
    }
    
    if (!userSnap?.exists()) {
      try {
        await setDoc(userRef, {
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, 'set', `users/${user.uid}`);
      }
    }
    return user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const registerWithEmail = async (email: string, pass: string, profileData: any) => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, pass);
    const user = result.user;
    
    await updateProfile(user, {
      displayName: profileData.displayName
    });

    const userRef = doc(db, 'users', user.uid);
    try {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: profileData.displayName,
        email: user.email,
        phone: profileData.phone || '',
        city: profileData.city || '',
        address: profileData.address || '',
        createdAt: serverTimestamp(),
      });

      // Notify registration
      try {
        await fetch('/api/notify-registration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: profileData.displayName,
            email: user.email,
            phone: profileData.phone || '',
            city: profileData.city || '',
            address: profileData.address || ''
          })
        });
      } catch (e) {
        console.error("Error notifying registration:", e);
      }
    } catch (err) {
      handleFirestoreError(err, 'set', `users/${user.uid}`);
    }

    return user;
  } catch (error) {
    console.error("Error registering with email", error);
    throw error;
  }
};

export const loginWithEmail = async (email: string, pass: string) => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    return result.user;
  } catch (error) {
    console.error("Error logging in with email", error);
    throw error;
  }
};

export const saveUserProfile = async (uid: string, data: any) => {
  try {
    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, data, { merge: true });
  } catch (err) {
    handleFirestoreError(err, 'set', `users/${uid}`);
  }
};

export const getUserProfile = async (uid: string) => {
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    handleFirestoreError(err, 'get', `users/${uid}`);
  }
};

export const createOrder = async (orderData: any) => {
  try {
    const ordersRef = collection(db, 'orders');
    return await addDoc(ordersRef, {
      ...orderData,
      created_at: new Date().toISOString(),
      status: orderData.status || 'pending'
    });
  } catch (err) {
    handleFirestoreError(err, 'add', 'orders');
  }
};

export const deleteOrder = async (id: string) => {
  try {
    await deleteDoc(doc(db, 'orders', id));
  } catch (err) {
    handleFirestoreError(err, 'delete', `orders/${id}`);
  }
};

export const createBuyerUser = async (userData: any) => {
  try {
    const buyersRef = collection(db, 'buyers');
    // Check if buyer already exists by email
    const q = query(buyersRef, where('email', '==', userData.email));
    const snap = await getDocs(q);
    if (snap.empty) {
      return await addDoc(buyersRef, {
        ...userData,
        role: 'buyer',
        createdAt: serverTimestamp()
      });
    }
    return snap.docs[0].ref;
  } catch (err) {
    console.error("Error creating buyer user:", err);
    // Don't block the order if buyer creation fails
    return null;
  }
};

export const getUserOrders = async (email: string) => {
  try {
    const ordersRef = collection(db, 'orders');
    const q = query(ordersRef, where('customer_email', '==', email), orderBy('created_at', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    handleFirestoreError(err, 'query', 'orders');
  }
};

// Store Entities
export const getProducts = async () => {
  try {
    const snap = await getDocs(query(collection(db, 'products'), orderBy('created_at', 'desc')));
    return snap.docs.map(doc => {
      const data = doc.data();
      // Ensure categories is always an array
      const categories = Array.isArray(data.categories) ? data.categories : (data.category ? [data.category] : []);
      return { id: doc.id, ...data, categories };
    });
  } catch (err) { handleFirestoreError(err, 'get', 'products'); }
};

export const saveProduct = async (id: string | null, data: any) => {
  try {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([key, value]) => value !== undefined && key !== 'id')
    );
    // Ensure categories is an array
    if (cleanData.categories && !Array.isArray(cleanData.categories)) {
      cleanData.categories = [cleanData.categories];
    }
    if (id) {
      await setDoc(doc(db, 'products', id), cleanData, { merge: true });
      return id;
    } else {
      const res = await addDoc(collection(db, 'products'), { ...cleanData, created_at: serverTimestamp() });
      return res.id;
    }
  } catch (err) { handleFirestoreError(err, 'save', 'products'); }
};

export const deleteProduct = async (id: string) => {
  try { await deleteDoc(doc(db, 'products', id)); }
  catch (err) { handleFirestoreError(err, 'delete', `products/${id}`); }
};

// Coupons
export const getCoupons = async () => {
  try {
    const snap = await getDocs(collection(db, 'coupons'));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) { handleFirestoreError(err, 'get', 'coupons'); }
};

export const saveCoupon = async (id: string | null, data: any) => {
  try {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([key, value]) => value !== undefined && key !== 'id')
    );
    if (id) {
      await setDoc(doc(db, 'coupons', id), cleanData, { merge: true });
      return id;
    } else {
      const res = await addDoc(collection(db, 'coupons'), cleanData);
      return res.id;
    }
  } catch (err) { handleFirestoreError(err, 'save', 'coupons'); }
};

export const deleteCoupon = async (id: string) => {
  try { await deleteDoc(doc(db, 'coupons', id)); }
  catch (err) { handleFirestoreError(err, 'delete', `coupons/${id}`); }
};

export const getFilters = async () => {
  try {
    const snap = await getDocs(collection(db, 'filters'));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) { handleFirestoreError(err, 'get', 'filters'); }
};

export const saveFilter = async (id: string | null, data: any) => {
  try {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([key, value]) => value !== undefined && key !== 'id')
    );
    if (id) {
      await setDoc(doc(db, 'filters', id), cleanData, { merge: true });
      return id;
    } else {
      const res = await addDoc(collection(db, 'filters'), cleanData);
      return res.id;
    }
  } catch (err) { handleFirestoreError(err, 'save', 'filters'); }
};

export const deleteFilter = async (id: string) => {
  try { await deleteDoc(doc(db, 'filters', id)); }
  catch (err) { handleFirestoreError(err, 'delete', `filters/${id}`); }
};

export const getCategories = async () => {
  try {
    const snap = await getDocs(query(collection(db, 'categories'), orderBy('name', 'asc')));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) { handleFirestoreError(err, 'get', 'categories'); }
};

export const saveCategory = async (id: string | null, data: any) => {
  console.log('firebase.ts: saveCategory called with:', { id, data });
  try {
    // Remove undefined values and id from data
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([key, value]) => value !== undefined && key !== 'id')
    );
    
    if (id) {
      console.log('firebase.ts: Updating category', id);
      await setDoc(doc(db, 'categories', id), cleanData, { merge: true });
      return id;
    } else {
      console.log('firebase.ts: Adding new category');
      const res = await addDoc(collection(db, 'categories'), cleanData);
      console.log('firebase.ts: New category added with ID:', res.id);
      return res.id;
    }
  } catch (err) { 
    console.error('firebase.ts: Error in saveCategory:', err);
    handleFirestoreError(err, 'save', 'categories'); 
  }
};

export const deleteCategory = async (id: string) => {
  try { await deleteDoc(doc(db, 'categories', id)); }
  catch (err) { handleFirestoreError(err, 'delete', `categories/${id}`); }
};

export const getBanners = async () => {
  try {
    const snap = await getDocs(query(collection(db, 'banners'), orderBy('order_index', 'asc')));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) { handleFirestoreError(err, 'get', 'banners'); }
};

export const saveBanner = async (id: string | null, data: any) => {
  try {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([key, value]) => value !== undefined && key !== 'id')
    );
    if (id) {
      await setDoc(doc(db, 'banners', id), cleanData, { merge: true });
      return id;
    } else {
      const res = await addDoc(collection(db, 'banners'), cleanData);
      return res.id;
    }
  } catch (err) { handleFirestoreError(err, 'save', 'banners'); }
};

export const deleteBanner = async (id: string) => {
  try { await deleteDoc(doc(db, 'banners', id)); }
  catch (err) { handleFirestoreError(err, 'delete', `banners/${id}`); }
};

export const getSettings = async () => {
  try {
    const snap = await getDocs(collection(db, 'settings'));
    return snap.docs.reduce((acc, doc) => ({ ...acc, [doc.id]: doc.data().value }), {});
  } catch (err) { handleFirestoreError(err, 'get', 'settings'); }
};

export const saveSettings = async (updates: any) => {
  try {
    console.log('firebase.ts: Intentando guardar configuraciones:', updates);
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        await setDoc(doc(db, 'settings', key), { value });
      }
    }
    console.log('firebase.ts: Configuraciones guardadas con éxito');
  } catch (err) { 
    console.error('firebase.ts: Error en saveSettings:', err);
    handleFirestoreError(err, 'save', 'settings'); 
  }
};

export const getOrders = async () => {
  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('created_at', 'desc')));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) { 
    console.error("Error getting all orders:", err);
    return []; 
  }
};

export const updateOrderStatus = async (id: string, status: string) => {
  try {
    const orderDoc = await getDoc(doc(db, 'orders', id));
    if (!orderDoc.exists()) throw new Error("Order not found");
    const orderData = orderDoc.data();

    await updateDoc(doc(db, 'orders', id), { status });

    // Notify user and admin
    try {
      await fetch('/api/notify-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: orderData.customer_email,
          orderNumber: orderData.order_number,
          status: status
        })
      });
    } catch (notifyErr) {
      console.error("Failed to send status notification:", notifyErr);
    }
  }
  catch (err) { handleFirestoreError(err, 'update', `orders/${id}`); }
};

export const getUsers = async (): Promise<any[]> => {
  try {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) { 
    handleFirestoreError(err, 'get', 'users');
    return [];
  }
};

export const updateUserRole = async (uid: string, role: string, approved: boolean) => {
  try {
    await updateDoc(doc(db, 'users', uid), { role, approved });
  } catch (err) { handleFirestoreError(err, 'update', `users/${uid}`); }
};

export const requestAdminAccess = async (email: string) => {
  try {
    const q = query(collection(db, 'admin_requests'), where('email', '==', email.toLowerCase()));
    const snap = await getDocs(q);
    if (!snap.empty) return snap.docs[0].id;

    const res = await addDoc(collection(db, 'admin_requests'), {
      email: email.toLowerCase(),
      status: 'pending',
      createdAt: serverTimestamp()
    });
    return res.id;
  } catch (err) { handleFirestoreError(err, 'add', 'admin_requests'); }
};

export const getAdminRequests = async (): Promise<any[]> => {
  try {
    const snap = await getDocs(query(collection(db, 'admin_requests'), orderBy('createdAt', 'desc')));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) { 
    handleFirestoreError(err, 'get', 'admin_requests');
    return [];
  }
};

export const updateAdminRequestStatus = async (id: string, status: string): Promise<void> => {
  try {
    await updateDoc(doc(db, 'admin_requests', id), { status });
  } catch (err) { handleFirestoreError(err, 'update', `admin_requests/${id}`); }
};

export const getAdminRequestByEmail = async (email: string): Promise<any> => {
  try {
    const q = query(collection(db, 'admin_requests'), where('email', '==', email.toLowerCase()));
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (err) { 
    handleFirestoreError(err, 'get', 'admin_requests');
    return null;
  }
};

export const logout = () => signOut(auth);

// Reviews
export const getReviews = async (productId: string) => {
  try {
    const q = query(collection(db, 'reviews'), where('productId', '==', productId));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => {
      const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
      const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
      return dateB - dateA;
    });
  } catch (err) { handleFirestoreError(err, 'get', `reviews?productId=${productId}`); }
};

export const addReview = async (reviewData: any) => {
  try {
    const res = await addDoc(collection(db, 'reviews'), {
      ...reviewData,
      createdAt: serverTimestamp()
    });
    return res.id;
  } catch (err) { handleFirestoreError(err, 'save', 'reviews'); }
};

// Wishlist
export const getWishlist = async (userId: string) => {
  try {
    const q = query(collection(db, 'wishlists'), where('userId', '==', userId));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) { handleFirestoreError(err, 'get', `wishlists?userId=${userId}`); }
};

export const addToWishlist = async (userId: string, productId: string) => {
  try {
    const res = await addDoc(collection(db, 'wishlists'), {
      userId,
      productId,
      createdAt: serverTimestamp()
    });
    return res.id;
  } catch (err) { handleFirestoreError(err, 'save', 'wishlists'); }
};

export const removeFromWishlist = async (userId: string, productId: string) => {
  try {
    const q = query(collection(db, 'wishlists'), where('userId', '==', userId), where('productId', '==', productId));
    const snap = await getDocs(q);
    for (const doc of snap.docs) {
      await deleteDoc(doc.ref);
    }
  } catch (err) { handleFirestoreError(err, 'delete', `wishlists?userId=${userId}&productId=${productId}`); }
};
