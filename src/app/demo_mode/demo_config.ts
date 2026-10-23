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

export interface DemoQuestion {
  /** Number key ('5' - '8') mapped to trigger this preset question. */
  key: string;
  /** Short badge label shown on the button. */
  label: string;
  /** Full natural-language question sent to the AI assistant. */
  question: string;
}

export interface DemoLocation {
  /** Number key ('1' - '4') mapped to jump to this preset location. */
  key: string;
  id: string;
  title: string;
  subtitle: string;
  address: string;
  latitude: number;
  longitude: number;
  heading: number;
  questions: DemoQuestion[];
}

export const GENERIC_QUESTIONS: DemoQuestion[] = [
  {
    key: '5',
    label: 'Storefronts & signs',
    question: 'What shops, restaurants, or signs are visible from here?',
  },
  {
    key: '6',
    label: 'Crosswalk & sidewalk',
    question: 'Is there a marked crosswalk, curb ramp, or obstacle on the sidewalk ahead?',
  },
  {
    key: '7',
    label: 'Street environment',
    question: 'Describe the buildings, trees, and street layout on this block.',
  },
  {
    key: '8',
    label: 'Walk forward (AI nav)',
    question: 'Move forward down the street.',
  },
];

export const DEMO_LOCATIONS: DemoLocation[] = [
  {
    key: '1',
    id: 'seattle-fremont-google',
    title: 'Seattle — Fremont (N 34th St)',
    subtitle: 'USA · Canal waterfront & tech campus',
    address: '601 N 34th St, Seattle, WA',
    latitude: 47.64917,
    longitude: -122.35046,
    heading: 283,
    questions: [
      {
        key: '5',
        label: 'Buildings & campus',
        question: 'What buildings, storefronts, or office entrances are visible along N 34th Street?',
      },
      {
        key: '6',
        label: 'Crosswalk & bike lane',
        question: 'Is there a marked crosswalk, bike lane, or curb ramp ahead?',
      },
      {
        key: '7',
        label: 'Sidewalk & surroundings',
        question: 'Describe the sidewalk, trees, and street layout on this block in Fremont.',
      },
      {
        key: '8',
        label: 'Walk forward (AI nav)',
        question: 'Move forward down North 34th Street.',
      },
    ],
  },
  {
    key: '2',
    id: 'paris-rue-de-rivoli',
    title: 'Paris — Rue de Rivoli (Marais)',
    subtitle: 'France · Historic arcades & cycleway near Hôtel de Ville',
    address: '20 Rue de Rivoli, Paris, France',
    latitude: 48.8566,
    longitude: 2.3522,
    heading: 110,
    questions: [
      {
        key: '5',
        label: 'Cafés & storefronts',
        question: 'What cafés, shops, or signs are visible along Rue de Rivoli?',
      },
      {
        key: '6',
        label: 'Bike lanes & crosswalks',
        question: 'Are there cycle lanes, pedestrian crossings, or bollards ahead?',
      },
      {
        key: '7',
        label: 'Haussmann architecture',
        question: 'Describe the building facades, balconies, and street layout here in central Paris.',
      },
      {
        key: '8',
        label: 'Walk forward (AI nav)',
        question: 'Move forward along Rue de Rivoli.',
      },
    ],
  },
  {
    key: '3',
    id: 'amsterdam-damrak',
    title: 'Amsterdam — Damrak (Centraal)',
    subtitle: 'Netherlands · Canal-front boulevard & historic gables',
    address: 'Damrak 1, Amsterdam, Netherlands',
    latitude: 52.3740,
    longitude: 4.8925,
    heading: 205,
    questions: [
      {
        key: '5',
        label: 'Gabled buildings & shops',
        question: 'What historic canal houses, shops, or signs can you see along Damrak?',
      },
      {
        key: '6',
        label: 'Trams, bikes & sidewalk',
        question: 'Where are the pedestrian sidewalk, cycle path, and tram tracks positioned?',
      },
      {
        key: '7',
        label: 'Waterfront & surroundings',
        question: 'Describe the street environment, canal boats, and pedestrian areas nearby.',
      },
      {
        key: '8',
        label: 'Walk forward (AI nav)',
        question: 'Move forward down Damrak.',
      },
    ],
  },
  {
    key: '4',
    id: 'brussels-boulevard-anspach',
    title: 'Brussels — Boulevard Anspach (Bourse)',
    subtitle: 'Belgium · Grand pedestrian boulevard & cafés',
    address: 'Boulevard Anspach, Brussels, Belgium',
    latitude: 50.8476,
    longitude: 4.3517,
    heading: 220,
    questions: [
      {
        key: '5',
        label: 'Landmarks & cafés',
        question: 'What ornate buildings, outdoor cafés, or storefronts are visible on Boulevard Anspach?',
      },
      {
        key: '6',
        label: 'Pedestrian zone layout',
        question: 'How is this pedestrian boulevard paved and laid out, and are there benches or planters ahead?',
      },
      {
        key: '7',
        label: 'Architectural details',
        question: 'Describe the architecture and street atmosphere around the Bourse in Brussels.',
      },
      {
        key: '8',
        label: 'Walk forward (AI nav)',
        question: 'Move forward along Boulevard Anspach.',
      },
    ],
  },
];
