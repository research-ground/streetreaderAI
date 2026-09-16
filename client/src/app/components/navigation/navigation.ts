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

import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Observable, of, concat } from 'rxjs';
import { startWith, switchMap, distinctUntilChanged, debounceTime } from 'rxjs/operators';
import { ApiService, AutocompleteItem } from '../../services/api_service';
import { CommandService } from '../../services/command_service';
import { map, catchError } from 'rxjs/operators';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { ErrorDialogComponent } from '../error_dialog/error_dialog';

interface AutocompleteState {
  status: 'idle' | 'loading' | 'empty' | 'results';
  items: AutocompleteItem[];
}

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule
  ],
  templateUrl: './navigation.html',
  styleUrl: './navigation.css',
})
export class NavigationComponent {
  private apiService = inject(ApiService);
  private commandService = inject(CommandService);
  private dialog = inject(MatDialog);

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly autocompleteState$: Observable<AutocompleteState>;

  private lastSearchTime = 0;

  constructor() {
    const idle: AutocompleteState = { status: 'idle', items: [] };

    // debounceTime waits for the user to pause before firing anything, so
    // "loading" only appears once we've actually kicked off the API call.
    // switchMap cancels in-flight requests if the user keeps typing, so
    // Nominatim only sees one request per typing pause.
    this.autocompleteState$ = this.searchControl.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(value => {
        if (!value) return of(idle);
        return concat(
          of<AutocompleteState>({ status: 'loading', items: [] }),
          this.apiService.autocompleteAddress(value).pipe(
            map(res => {
              const items = res.suggestions || [];
              const status: AutocompleteState['status'] = items.length === 0 ? 'empty' : 'results';
              return { status, items };
            }),
            catchError(err => {
              const errMsg = err?.error?.message || err?.message || 'Unknown error occurred.';
              this.dialog.open(ErrorDialogComponent, {
                data: { title: 'Autocomplete Error', message: errMsg },
                width: '400px'
              });
              return of<AutocompleteState>({ status: 'empty', items: [] });
            })
          )
        );
      })
    );
  }

  protected loadAddress(addressOverride?: string) {
    const now = Date.now();
    if (now - this.lastSearchTime < 300) return;

    const address = addressOverride || this.searchControl.value;
    if (address) {
      this.lastSearchTime = now;
      this.commandService.execute({ type: 'SEARCH_ADDRESS', payload: address });
    }
  }
}
