import { Component, ChangeDetectionStrategy, output } from '@angular/core';

@Component({
  selector: 'app-matchmaking',
  templateUrl: './matchmaking.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatchmakingComponent {
  cancel = output<void>();
}
