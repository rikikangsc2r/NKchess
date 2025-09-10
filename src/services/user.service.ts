import { Injectable, signal } from '@angular/core';

export interface User {
  username: string;
  deviceId: string;
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
  currentUser = signal<User | null>(null);

  constructor() {
    this.loadUserFromStorage();
  }

  private loadUserFromStorage() {
    try {
      const userJson = localStorage.getItem('nkchess_user');
      if (userJson) {
        this.currentUser.set(JSON.parse(userJson));
      }
    } catch (e) {
      console.error('Failed to load user from local storage', e);
      localStorage.removeItem('nkchess_user');
    }
  }

  login(username: string) {
    if (!username.trim()) return;

    const user: User = {
      username: username.trim(),
      deviceId: this.getOrCreateDeviceId(),
    };
    
    try {
        localStorage.setItem('nkchess_user', JSON.stringify(user));
        this.currentUser.set(user);
    } catch (e) {
        console.error('Failed to save user to local storage', e);
    }
  }

  private getOrCreateDeviceId(): string {
    let deviceId = localStorage.getItem('nkchess_deviceId');
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem('nkchess_deviceId', deviceId);
    }
    return deviceId;
  }
}
