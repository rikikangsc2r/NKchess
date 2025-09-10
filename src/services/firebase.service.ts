import { Injectable } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import { Database, get, getDatabase, onValue, ref, set, Unsubscribe, update } from 'firebase/database';

const FIREBASE_CONFIG = {
  databaseURL: "https://nirkyy-game-default-rtdb.firebaseio.com/",
};

@Injectable({
  providedIn: 'root',
})
export class FirebaseService {
  private app: FirebaseApp;
  private db: Database;

  constructor() {
    this.app = initializeApp(FIREBASE_CONFIG);
    this.db = getDatabase(this.app);
  }

  getData(path: string) {
    return get(ref(this.db, path));
  }

  setData(path: string, data: unknown) {
    return set(ref(this.db, path), data);
  }

  updateData(path: string, data: object) {
    return update(ref(this.db, path), data);
  }

  onDataChange(path: string, callback: (snapshot: any) => void): Unsubscribe {
    return onValue(ref(this.db, path), callback);
  }
}
