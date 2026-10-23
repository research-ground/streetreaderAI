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

import { Component, inject, computed, effect, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { StateService } from '../../services/state_service';
import { CommandService } from '../../services/command_service';
import { SpeechInputService } from '../../services/speech_input_service';
import { DemoModeService, DemoQuestion } from '../../demo_mode';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    ReactiveFormsModule,
  ],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})
export class ChatComponent implements AfterViewInit, OnDestroy {
  private stateService = inject(StateService);
  private commandService = inject(CommandService);
  protected speechInputService = inject(SpeechInputService);
  protected demoService = inject(DemoModeService);

  protected readonly chatControl = new FormControl('');
  private transcriptSub: Subscription;

  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

  protected readonly isAsking = computed(() => {
    const history = this.stateService.state().chatHistory;
    if (history.length === 0) return false;
    return history[history.length - 1].role === 'user';
  });

  protected readonly chatHistory = computed(() => this.stateService.state().chatHistory);

  constructor() {
    this.transcriptSub = this.speechInputService.transcription$.subscribe((transcript) => {
      this.chatControl.setValue(transcript);
      this.sendMessage();
    });

    effect(() => {
      this.chatHistory();
      this.scrollToBottom();
    });
  }

  ngAfterViewInit() {
    this.scrollToBottom();
  }

  ngOnDestroy() {
    this.transcriptSub.unsubscribe();
  }

  protected sendMessage() {
    const message = this.chatControl.value;
    if (message && !this.isAsking()) {
      this.stateService.addChatMessage('user', message);
      this.commandService.execute({ type: 'EXECUTE_AI_ACTION', payload: message });
      this.chatControl.reset();
    }
  }

  protected askSuggestedQuestion(q: DemoQuestion): void {
    this.demoService.askQuestion(q);
  }

  protected toggleListening() {
    if (this.speechInputService.listening()) {
      this.speechInputService.stopListening();
    } else {
      this.speechInputService.startListening();
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      try {
        if (this.scrollContainer?.nativeElement) {
          this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
        }
      } catch (err) {
        console.error('Error scrolling to bottom:', err);
      }
    }, 0);
  }
}
