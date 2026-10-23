/*
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-activation-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Speech Activation Required</h2>
    <mat-dialog-content>
      <div class="dialog-message">
        Click <strong>Activate</strong> or press <strong>Enter</strong> to enable speech output and begin your session.
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button color="primary" (click)="activate()" cdkFocusInitial>Activate</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { 
      overflow: hidden; 
      padding-top: 20px;
      padding-bottom: 20px;
      min-height: 60px;
    }
    .dialog-message {
      font-size: 16px;
      line-height: 1.5;
    }
    mat-dialog-actions { 
      padding: 16px 24px 24px 24px; 
    }
  `]
})
export class ActivationDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ActivationDialogComponent>);

  constructor() {
    this.dialogRef.backdropClick().subscribe(() => {
      this.activate();
    });
  }

  @HostListener('window:keydown', ['$event'])
  protected handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === 'Escape') {
      this.activate();
    }
  }

  protected activate() {
    this.dialogRef.close(true);
  }
}
