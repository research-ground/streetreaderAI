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

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { DemoModeService } from './demo_mode_service';
import { NavigationComponent } from '../components/navigation/navigation';
import { ChatComponent } from '../components/chat/chat';
import { NavigationService } from '../services/navigation_service';
import { CommandService } from '../services/command_service';
import { StateService } from '../services/state_service';
import { vi } from 'vitest';

describe('DemoModeModule', () => {
  let demoService: DemoModeService;
  let navService: NavigationService;
  let commandService: CommandService;
  let stateService: StateService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavigationComponent, ChatComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    demoService = TestBed.inject(DemoModeService);
    navService = TestBed.inject(NavigationService);
    commandService = TestBed.inject(CommandService);
    stateService = TestBed.inject(StateService);
  });

  it('maps number keys 1-4 and 5-7 and switches to generic questions on custom address search', () => {
    const loadCoordsSpy = vi.spyOn(navService, 'loadCoordinates').mockImplementation(() => {});
    const cmdSpy = vi.spyOn(commandService, 'execute');

    expect(demoService.enabled()).toBe(true);

    // Press '3' to jump to 3rd preset location (Amsterdam — Oudezijds Voorburgwal)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(demoService.activeLocation()?.id).toBe('amsterdam-oudezijds-voorburgwal');
    expect(loadCoordsSpy).toHaveBeenCalledWith(52.37299, 4.89696, 38);

    // When LLM suggestedQuestions are populated in StateService, activeQuestions uses up to 3
    stateService.setMetadata({
      suggestedQuestions: [
        'What does the sign on the corner canal house say?',
        'Is there a railing along the canal edge ahead?',
        'Are there bicycles parked on the bridge to the right?',
        'How wide is the brick sidewalk on this side?',
      ],
    });
    expect(demoService.activeQuestions().length).toBe(3);
    expect(demoService.activeQuestions()[0].question).toBe(
      'What does the sign on the corner canal house say?'
    );

    // Press '5' to ask first LLM-suggested question
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '5' }));
    expect(cmdSpy).toHaveBeenCalledWith({
      type: 'EXECUTE_AI_ACTION',
      payload: 'What does the sign on the corner canal house say?',
    });
    expect(stateService.state().chatHistory.length).toBeGreaterThan(0);

    // Searching a custom address clears preset selection and falls back to generic questions when LLM questions are reset
    stateService.setMetadata({ suggestedQuestions: [] });
    commandService.execute({ type: 'SEARCH_ADDRESS', payload: '123 Custom St, Chicago, IL' });
    expect(demoService.activeLocation()).toBeNull();
    expect(demoService.activeQuestions()[0].label).toBe('Storefronts & signs');
  });

  it('renders unified NavigationComponent and ChatComponent with preset buttons', () => {
    const navFixture = TestBed.createComponent(NavigationComponent);
    navFixture.detectChanges();
    expect(navFixture.nativeElement.querySelectorAll('.demo-loc-btn').length).toBe(4);

    const chatFixture = TestBed.createComponent(ChatComponent);
    chatFixture.detectChanges();
    expect(chatFixture.nativeElement.querySelectorAll('.demo-q-btn').length).toBe(3);
  });
});
