import { Component, ChangeDetectionStrategy, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class MenuComponent {
  userService = inject(UserService);
  startLocalGame = output<void>();
  startMatchmaking = output<void>();
  user = this.userService.currentUser;
}
