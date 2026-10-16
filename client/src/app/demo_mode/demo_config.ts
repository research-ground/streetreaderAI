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

export const DEMO_LOCATIONS: DemoLocation[] = [
  {
    key: '1',
    id: 'seattle-fremont-google',
    title: 'Fremont (Google Office / N 34th St)',
    subtitle: 'Seattle, WA · Canal waterfront & tech campus',
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
    id: 'seattle-capitol-hill',
    title: 'Capitol Hill (15th Ave E)',
    subtitle: 'Seattle, WA · Neighborhood retail & crosswalks',
    address: '411 15th Ave E, Seattle, WA',
    latitude: 47.62235,
    longitude: -122.31283,
    heading: 0,
    questions: [
      {
        key: '5',
        label: 'Storefronts & businesses',
        question: 'What shops, restaurants, or businesses are visible on either side of the street?',
      },
      {
        key: '6',
        label: 'Crosswalk & sidewalk',
        question: 'Is there a marked crosswalk or curb ramp ahead, and are there any obstacles on the sidewalk?',
      },
      {
        key: '7',
        label: 'Street environment',
        question: 'Describe the trees, parked cars, and building architecture along this block.',
      },
      {
        key: '8',
        label: 'Walk forward (AI nav)',
        question: 'Move forward down the street.',
      },
    ],
  },
  {
    key: '3',
    id: 'seattle-university-way',
    title: 'University Way ("The Ave")',
    subtitle: 'Seattle, WA · Bustling campus shopping strip',
    address: '4311 University Way NE, Seattle, WA',
    latitude: 47.65985,
    longitude: -122.31312,
    heading: 1,
    questions: [
      {
        key: '5',
        label: 'Restaurants & signs',
        question: 'What restaurants, cafés, or shop signs can you read along University Way?',
      },
      {
        key: '6',
        label: 'Sidewalk & pedestrians',
        question: 'What is on the sidewalk ahead, and are there any street trees, signs, or benches?',
      },
      {
        key: '7',
        label: 'Building style',
        question: 'Describe the brick buildings and storefronts along this block of The Ave.',
      },
      {
        key: '8',
        label: 'Walk forward (AI nav)',
        question: 'Move forward up University Way.',
      },
    ],
  },
  {
    key: '4',
    id: 'seattle-downtown-library',
    title: 'Downtown (Central Library / 4th Ave)',
    subtitle: 'Seattle, WA · Iconic glass architecture & downtown core',
    address: '1000 4th Ave, Seattle, WA',
    latitude: 47.60670,
    longitude: -122.33250,
    heading: 330,
    questions: [
      {
        key: '5',
        label: 'Architecture & landmarks',
        question: 'Describe the architecture of the buildings and landmarks visible along 4th Avenue.',
      },
      {
        key: '6',
        label: 'Intersection & crosswalks',
        question: 'How is this downtown street laid out for a pedestrian, and where are the crosswalks?',
      },
      {
        key: '7',
        label: 'Entrances & transit',
        question: 'Are there any building entrances, bus stops, or street signs visible from here?',
      },
      {
        key: '8',
        label: 'Walk forward (AI nav)',
        question: 'Move forward along 4th Avenue.',
      },
    ],
  },
];
