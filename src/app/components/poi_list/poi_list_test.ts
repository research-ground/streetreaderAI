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

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { PoiListComponent } from './poi_list';
import { StateService } from '../../services/state_service';
import { safeStorage } from '../../services/safe_storage';

describe('PoiListComponent', () => {
  let component: PoiListComponent;
  let fixture: ComponentFixture<PoiListComponent>;
  let stateService: StateService;

  beforeEach(async () => {
    safeStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PoiListComponent],
      providers: [provideHttpClient()]
    })
    .compileComponents();

    stateService = TestBed.inject(StateService);
    fixture = TestBed.createComponent(PoiListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('limits displayed POIs to 3 by default and respects maxPoiItems', () => {
    const rel = { side: 'LEFT' as const, depth: 'FRONT' as const };
    stateService.setMetadata({
      nearbyPOIs: [
        { name: 'Place 1', vicinity: '1st Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
        { name: 'Place 2', vicinity: '2nd Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
        { name: 'Place 3', vicinity: '3rd Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
        { name: 'Place 4', vicinity: '4th Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
        { name: 'Place 5', vicinity: '5th Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
      ],
    });
    fixture.detectChanges();

    const itemsDefault = fixture.nativeElement.querySelectorAll('mat-list-item');
    expect(itemsDefault.length).toBe(3);

    stateService.setMaxPoiItems(5);
    fixture.detectChanges();
    const itemsFive = fixture.nativeElement.querySelectorAll('mat-list-item');
    expect(itemsFive.length).toBe(5);
  });
});
