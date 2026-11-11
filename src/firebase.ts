import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getDatabase, ref } from 'firebase/database'

const app = initializeApp({
  apiKey: 'AIzaSyCfM6CyOcZaHbcx23gTNXUxA1H5uJFeV0I',
  authDomain: 'room-live-manager.firebaseapp.com',
  databaseURL: 'https://room-live-manager-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'room-live-manager',
  storageBucket: 'room-live-manager.firebasestorage.app',
  messagingSenderId: '328459769614',
  appId: '1:328459769614:web:23c4a0664efdd0009ca95f',
})

export const auth = getAuth(app)
export const database = getDatabase(app)
export const roomLiveRef = ref(database, 'roomLive')
export const ADMIN_UID = 'P4ksHlEQiqNhQRRHKdPRAaE8Srb2'
