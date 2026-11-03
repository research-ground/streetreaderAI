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
    subtitle: 'USA · Fremont Ave N & N 34th St intersection',
    address: '601 N 34th St, Seattle, WA',
    latitude: 47.64948,
    longitude: -122.34979,
    heading: 356,
    questions: GENERIC_QUESTIONS,
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
    questions: GENERIC_QUESTIONS,
  },
  {
    key: '3',
    id: 'amsterdam-oudezijds-voorburgwal',
    title: 'Amsterdam — Oudezijds Voorburgwal',
    subtitle: 'Netherlands · Historic canal houses & bridges',
    address: 'Oudezijds Voorburgwal, Amsterdam, Netherlands',
    latitude: 52.37299,
    longitude: 4.89696,
    heading: 38,
    questions: GENERIC_QUESTIONS,
  },
  {
    key: '4',
    id: 'lyon-place-bellecour',
    title: 'Lyon — Place Bellecour & Rue Émile Zola',
    subtitle: 'France · Grand square & pedestrian shopping quarter',
    address: 'Place Bellecour, Lyon, France',
    latitude: 45.7584,
    longitude: 4.83249,
    heading: 287,
    questions: GENERIC_QUESTIONS,
  },
];
