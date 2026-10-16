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
import { DemoNavigationComponent } from './demo_navigation';
import { DemoChatComponent } from './demo_chat';
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
    localStorage.removeItem('streetreader_demo_mode');
    await TestBed.configureTestingModule({
      imports: [DemoNavigationComponent, DemoChatComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    demoService = TestBed.inject(DemoModeService);
    navService = TestBed.inject(NavigationService);
    commandService = TestBed.inject(CommandService);
    stateService = TestBed.inject(StateService);
  });

  it('activates demo mode from runtime config and maps number keys 1-4 and 5-8', () => {
    const loadCoordsSpy = vi.spyOn(navService, 'loadCoordinates').mockImplementation(() => {});
    const cmdSpy = vi.spyOn(commandService, 'execute').mockImplementation(() => {});

    demoService.applyRuntimeConfig(true);
    expect(demoService.enabled()).toBe(true);

    // Press '3' to jump to 3rd demo location (University Way)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(demoService.activeLocation().id).toBe('seattle-university-way');
    expect(loadCoordsSpy).toHaveBeenCalledWith(47.65985, -122.31312, 1);

    // Press '5' to ask first question for University Way
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '5' }));
    expect(cmdSpy).toHaveBeenCalledWith({
      type: 'EXECUTE_AI_ACTION',
      payload: demoService.activeQuestions()[0].question,
    });
    expect(stateService.state().chatHistory.length).toBeGreaterThan(0);
  });

  it('renders DemoNavigationComponent and DemoChatComponent', () => {
    demoService.setEnabled(true);
    const navFixture = TestBed.createComponent(DemoNavigationComponent);
    navFixture.detectChanges();
    expect(navFixture.nativeElement.querySelectorAll('.demo-loc-btn').length).toBe(4);

    const chatFixture = TestBed.createComponent(DemoChatComponent);
    chatFixture.detectChanges();
    expect(chatFixture.nativeElement.querySelectorAll('.demo-q-btn').length).toBe(4);
  });
});
