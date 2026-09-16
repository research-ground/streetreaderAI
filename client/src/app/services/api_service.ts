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

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface AppRuntimeConfig {
  startingAddress: string;
}

export interface AutocompleteItem {
  description: string;
  placeId: string;
}

export interface AutocompleteResponse {
  success?: boolean;
  suggestions: AutocompleteItem[];
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export type ImageStatus = 'ok' | 'path_only';

export interface Link {
  canonicalNodeId: string;
  imageId?: string | null;
  heading: number;
  coordinates: LatLng;
  distanceMeters: number;
  streetName?: string;
  status: ImageStatus;
  captureTime?: string | null;
  isPano?: boolean;
  lane?: 'right' | 'left' | 'center' | null;
  /** Road tangent at the landing node in the direction of travel — the heading
   * to adopt on arrival so the view faces down the road (matters on curves). */
  arrivalHeading?: number | null;
}

export interface PanoramaMetadata {
  coordinates: LatLng;
  captureTime: string;
}

export interface GetViewResponse {
  success?: boolean;
  image?: string | null;
  name?: string | null;              // image_id when present
  canonicalNodeId?: string;
  actualHeading: number;
  panoramaMetadata?: PanoramaMetadata;
  links?: Link[];
  status: ImageStatus;
  message?: string | null;
  lane?: 'right' | 'left' | 'center' | null;
  isPano?: boolean;
}

export interface GetAddressResponse {
  success?: boolean;
  address: string;
}

export interface RelativePosition {
  side: 'LEFT' | 'RIGHT' | 'left' | 'right';
  depth: 'FRONT' | 'BEHIND' | 'front' | 'behind';
}

export interface NearbyPlace {
  name: string;
  vicinity: string;
  location: LatLng;
  types: string[];
  relativePosition: RelativePosition;
}

export interface GetNearbyPlacesResponse {
  success?: boolean;
  places: NearbyPlace[];
}

export interface DescribeImageResponse {
  success?: boolean;
  description: string;
}

export interface AskQuestionResponse {
  success?: boolean;
  answer: string;
  navigationalAction: 'TURN_LEFT' | 'TURN_RIGHT' | 'TURN_AROUND' | 'MOVE_FORWARD' | 'MOVE_BACKWARD' | 'NONE';
}

export interface DebugNode {
  canonicalNodeId: string;
  coordinates: LatLng;
  kind: 'intersection' | 'waypoint';
  status: 'ok' | 'path_only' | 'unknown';
  imageId?: string | null;
  streetNames: string[];
}

export interface DebugEdge {
  fromId: string;
  toId: string;
  bearing: number;
  lengthMeters: number;
  streetName: string;
}

export interface LocalGraphResponse {
  success?: boolean;
  center: LatLng;
  radiusMeters: number;
  currentNodeId?: string | null;
  nodes: DebugNode[];
  edges: DebugEdge[];
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private readonly apiUrl = '/v1/streetreader';

  getConfig(): Observable<AppRuntimeConfig> {
    return this.http.get<AppRuntimeConfig>(`${this.apiUrl}:config`);
  }

  autocompleteAddress(query: string, sessionToken?: string): Observable<AutocompleteResponse> {
    return this.http.post<AutocompleteResponse>(`${this.apiUrl}:autocompletePlace`, { 
      query, 
      session_token: sessionToken 
    });
  }

  getLocalGraph(params: { lat: number; lng: number; radiusMeters?: number }): Observable<LocalGraphResponse> {
    return this.http.post<LocalGraphResponse>(`${this.apiUrl}:getLocalGraph`, {
      coordinates: { latitude: params.lat, longitude: params.lng },
      radiusMeters: params.radiusMeters ?? 80,
    });
  }

  getView(params: {
    canonicalNodeId?: string;
    imageId?: string;
    address?: string;
    coordinates?: LatLng;
    heading?: number;
    pitch?: number;
    imageOnly?: boolean;
  }): Observable<GetViewResponse> {
    const payload: Record<string, unknown> = {
      heading: params.heading,
      pitch: params.pitch,
    };
    if (params.canonicalNodeId) payload['canonicalNodeId'] = params.canonicalNodeId;
    if (params.imageId) payload['name'] = params.imageId;
    if (params.address) payload['address'] = params.address;
    if (params.coordinates) payload['coordinates'] = params.coordinates;
    if (params.imageOnly) payload['imageOnly'] = true;

    return this.http.post<GetViewResponse>(`${this.apiUrl}:generatePanoramaView`, payload).pipe(
      tap(res => console.log('View node:', res.canonicalNodeId, 'image:', res.name, 'status:', res.status))
    );
  }

  getAddress(lat: number, lng: number): Observable<GetAddressResponse> {
    return this.http.post<GetAddressResponse>(`${this.apiUrl}:resolveAddress`, { 
        coordinates: { latitude: lat, longitude: lng } 
    });
  }

  getNearbyPlaces(params: { lat: number; lng: number; radius?: number; heading?: number }): Observable<GetNearbyPlacesResponse> {
    const payload = {
        location: { latitude: params.lat, longitude: params.lng },
        heading: params.heading,
    };
    return this.http.post<GetNearbyPlacesResponse>(`${this.apiUrl}:searchNearbyPlaces`, payload);
  }

  describeImage(imageBytes: string): Observable<DescribeImageResponse> {
    return this.http.post<DescribeImageResponse>(`${this.apiUrl}:describeImage`, { image: imageBytes });
  }

  askQuestion(imageBytes: string, question: string, detectActions: boolean = false): Observable<AskQuestionResponse> {
    return this.http.post<AskQuestionResponse>(`${this.apiUrl}:askQuestion`, { 
      image: imageBytes, 
      question, 
      detect_navigational_intent: detectActions 
    });
  }
}
