
import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class LoginComponent {
  userService = inject(UserService);
  username = signal('');

  onUsernameInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.username.set(input.value);
  }

  submitUsername() {
    this.userService.login(this.username());
  }
}
