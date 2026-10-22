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
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface AppRuntimeConfig {
  startingAddress: string;
  imageryProvider?: string;
  demoMode?: boolean;
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
  /** Road tangent at the landing node in the direction of travel — the heading
   * to adopt on arrival so the view faces down the road (matters on curves). */
  arrivalHeading?: number | null;
}

export interface GetViewResponse {
  success?: boolean;
  image?: string | null;
  imageId?: string | null;
  canonicalNodeId?: string;
  actualHeading: number;
  coordinates?: LatLng;
  captureTime?: string;
  address?: string | null;
  links?: Link[];
  status: ImageStatus;
  message?: string | null;
  isPano?: boolean;
}

export interface RenderViewResponse {
  success?: boolean;
  imageId: string;
  image: string;
  actualHeading: number;
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
  sequenceId?: string | null;
}

export interface DebugEdge {
  fromId: string;
  toId: string;
  bearing: number;
  lengthMeters: number;
  streetName: string;
  polyline?: LatLng[];
}

export interface QueryAuditSummary {
  external_calls: Record<string, number>;
  total_external_calls: number;
  cache_hits: Record<string, number>;
  total_cache_hits: number;
  duplicate_queries: string[];
  duplicate_count: number;
}

export interface LocalGraphResponse {
  success?: boolean;
  center: LatLng;
  radiusMeters: number;
  currentNodeId?: string | null;
  nodes: DebugNode[];
  edges: DebugEdge[];
  queryAudit?: QueryAuditSummary | null;
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
  }): Observable<GetViewResponse> {
    const payload: Record<string, unknown> = {
      heading: params.heading,
      pitch: params.pitch,
    };
    if (params.canonicalNodeId) payload['canonicalNodeId'] = params.canonicalNodeId;
    if (params.imageId) payload['imageId'] = params.imageId;
    if (params.address) payload['address'] = params.address;
    if (params.coordinates) payload['coordinates'] = params.coordinates;

    return this.http.post<GetViewResponse>(`${this.apiUrl}:generatePanoramaView`, payload).pipe(
      tap(res => console.log('View node:', res.canonicalNodeId, 'image:', res.imageId, 'status:', res.status))
    );
  }

  renderView(params: {
    imageId: string;
    heading?: number;
    pitch?: number;
  }): Observable<RenderViewResponse> {
    return this.http.post<RenderViewResponse>(`${this.apiUrl}:renderView`, {
      imageId: params.imageId,
      heading: params.heading ?? 0,
      pitch: params.pitch ?? 0,
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
    return this.http.post<DescribeImageResponse>(
      `${this.apiUrl}:describeImage`,
      { image: imageBytes },
      this.getAiRequestOptions()
    );
  }

  askQuestion(imageBytes: string, question: string, detectActions: boolean = false): Observable<AskQuestionResponse> {
    return this.http.post<AskQuestionResponse>(
      `${this.apiUrl}:askQuestion`,
      { 
        image: imageBytes, 
        question, 
        detect_navigational_intent: detectActions 
      },
      this.getAiRequestOptions()
    );
  }

  private getAiRequestOptions(): { headers?: HttpHeaders } {
    const geminiKey = this.getGeminiKeyFromUrl();
    if (!geminiKey) {
      return {};
    }
    return {
      headers: new HttpHeaders({ 'X-Gemini-Api-Key': geminiKey }),
    };
  }

  private getGeminiKeyFromUrl(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const urlKey = params.get('gemini_key') ?? params.get('geminiKey');
      if (urlKey !== null) {
        const trimmed = urlKey.trim();
        if (trimmed) {
          sessionStorage.setItem('streetreader_gemini_key', trimmed);
          return trimmed;
        } else {
          sessionStorage.removeItem('streetreader_gemini_key');
          return null;
        }
      }
      return sessionStorage.getItem('streetreader_gemini_key');
    } catch {
      return null;
    }
  }
}
