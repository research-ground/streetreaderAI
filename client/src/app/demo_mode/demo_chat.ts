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

import { AfterViewInit, Component, ElementRef, ViewChild, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { StateService } from '../services/state_service';
import { DemoModeService } from './demo_mode_service';
import { DemoQuestion } from './demo_config';

@Component({
  selector: 'app-demo-chat',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="demo-chat-container">
      <div class="messages-list" #scrollContainer role="log" aria-live="polite" aria-relevant="additions">
        @if (chatHistory().length === 0) {
          <p class="empty-message">
            Press keys <strong>5&ndash;8</strong> to ask a suggested question for
            <strong>{{ demoService.activeLocation().title }}</strong>.
          </p>
        }
        @for (msg of chatHistory(); track msg.timestamp) {
          <div class="message" [ngClass]="msg.role">
            <div class="message-content">
              <span class="sr-only">{{ msg.role === 'user' ? 'You said:' : 'Assistant said:' }}</span>
              {{ msg.content }}
            </div>
          </div>
        }
        @if (isAsking()) {
          <div class="message assistant typing" aria-busy="true">
            <div class="message-content">Thinking...</div>
          </div>
        }
      </div>

      <div class="demo-questions-area" role="group" aria-label="Suggested questions for current location">
        <div class="demo-questions-header">
          Example Questions to Ask (press keys <strong>5&ndash;8</strong> or click):
        </div>
        <div class="demo-questions-list">
          @for (q of demoService.activeQuestions(); track q.key) {
            <button
              type="button"
              class="demo-q-btn"
              [disabled]="isAsking()"
              (click)="askQuestion(q)"
              [attr.aria-label]="'Key ' + q.key + ': ' + q.question">
              <span class="key-badge" aria-hidden="true">{{ q.key }}</span>
              <span class="q-question">{{ q.question }}</span>
            </button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .demo-chat-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .messages-list {
      max-height: 170px;
      overflow-y: auto;
      padding: 6px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .empty-message {
      margin: 8px 4px;
      font-size: 12px;
      color: #64748b;
    }
    .message {
      display: flex;
    }
    .message.user {
      justify-content: flex-end;
    }
    .message.assistant {
      justify-content: flex-start;
    }
    .message-content {
      max-width: 88%;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12.5px;
      line-height: 1.4;
    }
    .message.user .message-content {
      background: #2563eb;
      color: #ffffff;
    }
    .message.assistant .message-content {
      background: #e2e8f0;
      color: #0f172a;
    }
    .demo-questions-header {
      font-size: 12.5px;
      font-weight: 600;
      color: #334155;
      margin-bottom: 6px;
    }
    .demo-questions-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .demo-q-btn {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      width: 100%;
      text-align: left;
      padding: 8px 10px;
      border-radius: 7px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .demo-q-btn:hover:not(:disabled) {
      background: #f0fdf4;
      border-color: #16a34a;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    }
    .demo-q-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .key-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 24px;
      margin-top: 1px;
      border-radius: 5px;
      background: #0f766e;
      color: #ffffff;
      font-family: monospace;
      font-weight: 700;
      font-size: 12.5px;
      flex-shrink: 0;
    }
    .q-question {
      font-size: 13.5px;
      font-weight: 600;
      line-height: 1.35;
      color: #0f172a;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      border: 0;
    }
  `],
})
export class DemoChatComponent implements AfterViewInit {
  private stateService = inject(StateService);
  protected demoService = inject(DemoModeService);

  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

  protected readonly chatHistory = computed(() => this.stateService.state().chatHistory);
  protected readonly isAsking = computed(() => {
    const history = this.stateService.state().chatHistory;
    if (history.length === 0) return false;
    return history[history.length - 1].role === 'user';
  });

  constructor() {
    effect(() => {
      this.chatHistory();
      this.scrollToBottom();
    });
  }

  ngAfterViewInit(): void {
    this.scrollToBottom();
  }

  protected askQuestion(q: DemoQuestion): void {
    this.demoService.askQuestion(q);
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.scrollContainer?.nativeElement) {
        this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
      }
    }, 0);
  }
}
