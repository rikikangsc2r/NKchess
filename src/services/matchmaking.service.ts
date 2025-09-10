import { Injectable, signal, inject, computed } from '@angular/core';
import { Unsubscribe } from 'firebase/database';
import { FirebaseService } from './firebase.service';
import { UserService, User } from './user.service';

const MAX_ROOMS = 20;
const ACTIVITY_TIMEOUT = 30000; // 30 seconds

export interface GameData {
  board: any[][];
  currentPlayer: 'w' | 'b';
  gameState: 'playing' | 'check' | 'checkmate' | 'stalemate' | 'promotion';
  winner: 'w' | 'b' | null;
  lastMove: { from: { row: number, col: number }, to: { row: number, col: number } } | null;
  promotionSquare: { row: number, col: number } | null;
  opponentLeft?: boolean;
}

interface Room {
  player1?: User;
  player2?: User;
  last_active_p1?: number;
  last_active_p2?: number;
  status: 'waiting' | 'playing' | 'finished';
  gameData?: GameData;
}

@Injectable({
  providedIn: 'root'
})
export class MatchmakingService {
  private firebaseService = inject(FirebaseService);
  private userService = inject(UserService);

  state = signal<'idle' | 'searching' | 'in-game' | 'error'>('idle');
  errorMessage = signal<string | null>(null);
  roomId = signal<string | null>(null);
  playerColor = signal<'w' | 'b' | null>(null);
  opponent = signal<User | null>(null);
  gameData = signal<GameData | null>(null);

  private roomUnsubscribe: Unsubscribe | null = null;
  private presenceInterval: any | null = null;

  async findMatch() {
    this.state.set('searching');
    const currentUser = this.userService.currentUser();
    if (!currentUser) {
      this.handleError('User not logged in.');
      return;
    }

    try {
      for (let i = 1; i <= MAX_ROOMS; i++) {
        const currentRoomId = `nk-${i}`;
        const roomSnapshot = await this.firebaseService.getData(`rooms/${currentRoomId}`);
        const room: Room | null = roomSnapshot.val();
        const now = Date.now();

        // Case 1: Room is empty or stale
        if (!room || !room.player1 || (now - (room.last_active_p1 ?? 0)) > ACTIVITY_TIMEOUT) {
          await this.createRoom(currentRoomId, currentUser);
          return;
        }

        // Case 2: Room has one player waiting
        if (room.status === 'waiting' && room.player1 && !room.player2 && room.player1.deviceId !== currentUser.deviceId) {
          await this.joinRoom(currentRoomId, room, currentUser);
          return;
        }
      }
      this.handleError('Server Sedang Penuh coba lagi nanti');
    } catch (error) {
      this.handleError('Failed to find a match.');
      console.error(error);
    }
  }

  private async createRoom(roomId: string, user: User) {
    this.roomId.set(roomId);
    this.playerColor.set('w');
    const initialBoard = this.createInitialBoard();
    const newRoom: Room = {
      player1: user,
      last_active_p1: Date.now(),
      status: 'waiting',
      gameData: {
        board: initialBoard,
        currentPlayer: 'w',
        gameState: 'playing',
        winner: null,
        lastMove: null,
        promotionSquare: null
      }
    };
    await this.firebaseService.setData(`rooms/${roomId}`, newRoom);
    this.listenToRoomUpdates(roomId);
  }

  private async joinRoom(roomId: string, room: Room, user: User) {
    this.roomId.set(roomId);
    this.playerColor.set('b');
    this.opponent.set(room.player1!);

    const updates = {
      player2: user,
      last_active_p2: Date.now(),
      status: 'playing'
    };
    await this.firebaseService.updateData(`rooms/${roomId}`, updates);
    this.listenToRoomUpdates(roomId);
  }
  
  listenToRoomUpdates(roomId: string) {
    if (this.roomUnsubscribe) this.roomUnsubscribe();
    this.roomUnsubscribe = this.firebaseService.onDataChange(`rooms/${roomId}`, (snapshot) => {
      const room: Room = snapshot.val();
      if (!room) {
        // Room was deleted or cleared, maybe game ended.
        this.leaveGame();
        return;
      }

      if (this.state() === 'searching' && room.status === 'playing' && room.player1 && room.player2) {
          this.state.set('in-game');
          const myColor = this.playerColor();
          this.opponent.set(myColor === 'w' ? room.player2! : room.player1!);
      }
      
      if (room.gameData) {
        this.gameData.set(room.gameData);
      }
      
      if(this.state() === 'in-game') {
          this.startPresenceUpdates();
          this.checkOpponentPresence(room);
      }
    });
  }
  
  private checkOpponentPresence(room: Room) {
    const now = Date.now();
    const myColor = this.playerColor();
    const opponentLastActive = myColor === 'w' ? room.last_active_p2 : room.last_active_p1;
    
    if (room.status === 'playing' && opponentLastActive && (now - opponentLastActive) > ACTIVITY_TIMEOUT) {
        this.handleOpponentDisconnect();
    }
  }

  private handleOpponentDisconnect() {
    if (this.gameData()?.winner) return; // Game already over
    const winner = this.playerColor();
    const updatedGameData = {
        ...this.gameData(),
        winner: winner,
        gameState: 'checkmate',
        opponentLeft: true,
    };
    this.updateGameState(updatedGameData as Partial<GameData>);
  }

  startPresenceUpdates() {
      if (this.presenceInterval) clearInterval(this.presenceInterval);
      this.presenceInterval = setInterval(() => {
          const roomId = this.roomId();
          if(!roomId) return;
          const key = this.playerColor() === 'w' ? 'last_active_p1' : 'last_active_p2';
          this.firebaseService.updateData(`rooms/${roomId}`, {[key]: Date.now()});
      }, 5000);
  }

  stopPresenceUpdates() {
    if (this.presenceInterval) clearInterval(this.presenceInterval);
    this.presenceInterval = null;
  }

  async updateGameState(data: Partial<GameData>) {
    const roomId = this.roomId();
    if (!roomId) return;
    await this.firebaseService.updateData(`rooms/${roomId}/gameData`, data);
  }

  async resignGame() {
    const opponentColor = this.playerColor() === 'w' ? 'b' : 'w';
    await this.updateGameState({ winner: opponentColor, gameState: 'checkmate' });
  }

  cancelSearch() {
    const roomId = this.roomId();
    if (roomId && this.playerColor() === 'w') {
      this.firebaseService.setData(`rooms/${roomId}`, null);
    }
    this.resetState();
  }

  leaveGame() {
      const roomId = this.roomId();
      // Only player 1 clears the room to allow for reconnects perhaps
      if (roomId && this.playerColor() === 'w') {
          this.firebaseService.setData(`rooms/${roomId}`, null);
      }
      this.resetState();
  }
  
  private resetState() {
      if (this.roomUnsubscribe) this.roomUnsubscribe();
      this.stopPresenceUpdates();
      this.state.set('idle');
      this.roomId.set(null);
      this.playerColor.set(null);
      this.opponent.set(null);
      this.gameData.set(null);
      this.errorMessage.set(null);
  }

  private handleError(message: string) {
    this.errorMessage.set(message);
    this.state.set('error');
    setTimeout(() => { // auto-clear error state
        this.state.set('idle');
        this.errorMessage.set(null);
    }, 5000);
  }
  
  private createInitialBoard() {
    const board = Array(8).fill(null).map(() => Array(8).fill(null));
    const place = (piece: any, row: number, col: number) => board[row][col] = piece;
    const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let i = 0; i < 8; i++) {
      place({ type: 'p', color: 'b' }, 1, i);
      place({ type: backRank[i], color: 'b', hasMoved: false }, 0, i);
      place({ type: 'p', color: 'w' }, 6, i);
      place({ type: backRank[i], color: 'w', hasMoved: false }, 7, i);
    }
    return board;
  }
}
