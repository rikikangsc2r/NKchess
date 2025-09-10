import { Component, ChangeDetectionStrategy, signal, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoginComponent } from './components/login/login.component';
import { MenuComponent } from './components/menu/menu.component';
import { GameBoardComponent } from './components/game-board/game-board.component';
import { MatchmakingComponent } from './components/matchmaking/matchmaking.component';
import { UserService, User } from './services/user.service';
import { MatchmakingService } from './services/matchmaking.service';

interface OnlineGameConfig {
  roomId: string;
  playerColor: 'w' | 'b';
  opponent: User;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, LoginComponent, MenuComponent, GameBoardComponent, MatchmakingComponent],
})
export class AppComponent {
  userService = inject(UserService);
  matchmakingService = inject(MatchmakingService);
  
  // App states: 'login', 'menu', 'matchmaking', 'game'
  currentView = signal<'login' | 'menu' | 'matchmaking' | 'game'>('login');
  gameMode = signal<'local' | 'online' | null>(null);
  onlineGameConfig = signal<OnlineGameConfig | null>(null);

  constructor() {
    // Effect to reactively update the view based on user login status
    effect(() => {
      if (this.userService.currentUser()) {
        if (this.currentView() === 'login') {
            this.currentView.set('menu');
        }
      } else {
        this.currentView.set('login');
      }
    });

    // Effect to react to matchmaking state changes
    effect(() => {
      const state = this.matchmakingService.state();
      const error = this.matchmakingService.errorMessage();
      
      if (error) {
        // Handle matchmaking errors, e.g., show a toast or alert
        console.error('Matchmaking Error:', error);
        // For simplicity, we'll just go back to the menu.
        this.currentView.set('menu');
        return;
      }
      
      switch (state) {
        case 'searching':
          this.currentView.set('matchmaking');
          break;
        case 'in-game':
          this.gameMode.set('online');
          this.onlineGameConfig.set({
            roomId: this.matchmakingService.roomId()!,
            playerColor: this.matchmakingService.playerColor()!,
            opponent: this.matchmakingService.opponent()!,
          });
          this.currentView.set('game');
          break;
        case 'idle':
           if (this.currentView() === 'matchmaking' || (this.currentView() === 'game' && this.gameMode() === 'online')) {
              this.currentView.set('menu');
           }
          break;
      }
    });
  }

  startLocalGame() {
    this.gameMode.set('local');
    this.currentView.set('game');
  }

  startMatchmaking() {
    this.matchmakingService.findMatch();
  }

  cancelMatchmaking() {
    this.matchmakingService.cancelSearch();
  }

  exitGame() {
    if (this.gameMode() === 'online') {
      this.matchmakingService.leaveGame();
    }
    this.gameMode.set(null);
    this.onlineGameConfig.set(null);
    this.currentView.set('menu');
  }
}