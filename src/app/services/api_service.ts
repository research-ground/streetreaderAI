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
import { Observable, defer, from, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AiProviderService } from './ai_provider_service';
import { ConfigService } from './config_service';
import { LocationProviderService } from './location_provider_service';
import { RouteProviderService } from './route_provider_service';

export interface AppRuntimeConfig {
  startingAddress: string;
  imageryProvider?: string;
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
  navigationalAction:
    | 'TURN_LEFT'
    | 'TURN_RIGHT'
    | 'TURN_AROUND'
    | 'MOVE_FORWARD'
    | 'MOVE_BACKWARD'
    | 'NONE';
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
  providedIn: 'root',
})
export class ApiService {
  private readonly config = inject(ConfigService);
  private readonly location = inject(LocationProviderService);
  private readonly routeProvider = inject(RouteProviderService);
  private readonly ai = inject(AiProviderService);

  getConfig(): Observable<AppRuntimeConfig> {
    return of({
      startingAddress: this.config.startingAddress(),
      imageryProvider: this.config.imageryProvider(),
    });
  }

  autocompleteAddress(
    query: string,
    sessionToken?: string
  ): Observable<AutocompleteResponse> {
    return defer(() =>
      from(this.location.autocomplete(query, sessionToken))
    );
  }

  getLocalGraph(params: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  }): Observable<LocalGraphResponse> {
    return defer(() =>
      from(
        this.routeProvider.getLocalGraph(
          params.lat,
          params.lng,
          params.radiusMeters ?? 80
        )
      )
    );
  }

  getView(params: {
    canonicalNodeId?: string;
    imageId?: string;
    address?: string;
    coordinates?: LatLng;
    heading?: number;
    pitch?: number;
  }): Observable<GetViewResponse> {
    return defer(() => from(this.routeProvider.getPanoView(params))).pipe(
      tap((res) =>
        console.log(
          'View node:',
          res.canonicalNodeId,
          'image:',
          res.imageId,
          'status:',
          res.status
        )
      )
    );
  }

  renderView(params: {
    imageId: string;
    heading?: number;
    pitch?: number;
  }): Observable<RenderViewResponse> {
    return defer(() => from(this.routeProvider.renderView(params)));
  }

  getNearbyPlaces(params: {
    lat: number;
    lng: number;
    radius?: number;
    heading?: number;
  }): Observable<GetNearbyPlacesResponse> {
    return defer(() => from(this.location.getNearbyPlaces(params)));
  }

  describeImage(imageBytes: string): Observable<DescribeImageResponse> {
    return defer(() => from(this.ai.describeImage(imageBytes)));
  }

  askQuestion(
    imageBytes: string,
    question: string,
    detectActions: boolean = false
  ): Observable<AskQuestionResponse> {
    return defer(() =>
      from(this.ai.askQuestion(imageBytes, question, detectActions))
    );
  }
}
