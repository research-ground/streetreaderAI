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

import { Component, Inject, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { SpeechOutputService } from '../../services/speech_output_service';

export interface ErrorDialogData {
  title: string;
  message: string;
  speakMessage?: boolean;
}

@Component({
  selector: 'app-error-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  templateUrl: './error_dialog.html',
  styleUrls: ['./error_dialog.css']
})
export class ErrorDialogComponent implements AfterViewInit {
  @ViewChild('closeButton') closeButton!: ElementRef;

  constructor(
    public dialogRef: MatDialogRef<ErrorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ErrorDialogData,
    private speechOutputService: SpeechOutputService
  ) {
    if (this.data.speakMessage !== false) {
      this.speechOutputService.speak(`Error: ${this.data.message}`);
    }
  }

  ngAfterViewInit() {
    // Ensure focus is trapped on the dismiss button for screen readers
    setTimeout(() => {
      this.closeButton?.nativeElement?.focus();
    });
  }

  onDismiss(): void {
    this.dialogRef.close();
  }
}
