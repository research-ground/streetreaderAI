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
import { ApiService, GetViewResponse, Link, NearbyPlace, RenderViewResponse } from './api_service';
import { StateService } from './state_service';
import { DescriptionService } from './description_service';
import { ToastService } from './toast_service';
import { MatDialog } from '@angular/material/dialog';
import { ErrorDialogComponent } from '../components/error_dialog/error_dialog';
import { Subscription } from 'rxjs';

/** What we remember about a node we've already visited this session. The
 * server is stateless; this cache is the session. Nothing survives a page
 * reload — by design. */
interface CachedNode {
  links: Link[];
  imageId: string | null;
  lat: number;
  lng: number;
  address?: string;
  pois?: NearbyPlace[];
}

@Injectable({ providedIn: 'root' })
export class NavigationService {
  private apiService = inject(ApiService);
  private stateService = inject(StateService);
  private descriptionService = inject(DescriptionService);
  private toastService = inject(ToastService);
  private dialog = inject(MatDialog);

  private nodeCache = new Map<string, CachedNode>();
  private viewSub?: Subscription;
  private poiSub?: Subscription;

  /** Address entered manually. One request: the view endpoint geocodes,
   * anchors, and returns image + links + address together. */
  loadAddress(address: string) {
    this.land({ address, heading: this.stateService.currentHeading() });
  }

  /** Initial-boot address load with an explicit facing heading. */
  loadLocationWithHeading(address?: string, heading: number = 0) {
    this.land({ address, heading });
  }

  /** Jump directly to known coordinates and facing heading (used by Demo Mode). */
  loadCoordinates(lat: number, lng: number, heading: number = 0) {
    this.stateService.setHeading(heading);
    this.land({ coordinates: { latitude: lat, longitude: lng }, heading });
  }

  /** Navigate to a specific image id (deep link). */
  navigateToImage(imageId: string) {
    this.land({ imageId, heading: this.stateService.currentHeading() });
  }

  /** Move along an adjacency link. Arrival heading comes from the link itself
   * (the road tangent at the landing), so no server-side alignment is needed.
   * Previously-visited nodes render from the cache with a pure renderView
   * request and keep exactly the links they had — the session never shifts
   * underfoot. New nodes take a full generatePanoramaView request. */
  navigateToNode(node: Link) {
    const heading = node.arrivalHeading ?? node.heading;
    this.stateService.setHeading(heading);
    const cached = this.nodeCache.get(node.canonicalNodeId);
    if (cached && cached.links.length > 0 && cached.imageId) {
      this.renderCachedNode(node.canonicalNodeId, cached, heading, true);
      return;
    }
    this.land({
      canonicalNodeId: node.canonicalNodeId,
      imageId: node.imageId ?? undefined,
      coordinates: node.coordinates,
      heading,
    });
  }

  /** Rotation / look: same node, new heading. If we've been here, this is a
   * pure image re-crop via renderView — no road or graph fetches at all. */
  updateViewForHeading() {
    const loc = this.stateService.currentLocation();
    if (!loc.canonicalNodeId) return;
    const heading = this.stateService.currentHeading();
    const cached = this.nodeCache.get(loc.canonicalNodeId);
    if (cached?.imageId) {
      this.renderCachedNode(loc.canonicalNodeId, cached, heading, false);
      return;
    }
    this.land({
      canonicalNodeId: loc.canonicalNodeId,
      coordinates: { latitude: loc.lat, longitude: loc.lng },
      heading,
    });
  }

  private renderCachedNode(
    canonicalNodeId: string,
    cached: CachedNode,
    heading: number,
    isStepChange: boolean,
  ) {
    if (!cached.imageId) return;
    this.viewSub?.unsubscribe();
    this.stateService.setLoading(true);
    this.viewSub = this.apiService.renderView({
      imageId: cached.imageId,
      heading,
    }).subscribe({
      next: (rendered: RenderViewResponse) => {
        this.stateService.setImage(rendered.image ?? null);
        const effectiveHeading =
          rendered.actualHeading !== undefined && rendered.actualHeading !== null
            ? rendered.actualHeading
            : heading;
        if (rendered.actualHeading !== undefined && rendered.actualHeading !== null) {
          this.stateService.setHeading(rendered.actualHeading);
        }
        const pois = cached.pois
          ? this.reorientPois(cached.pois, cached.lat, cached.lng, effectiveHeading)
          : this.reorientPois(this.stateService.state().nearbyPOIs, cached.lat, cached.lng, effectiveHeading);
        if (isStepChange) {
          this.stateService.updateLocation(
            cached.lat,
            cached.lng,
            rendered.imageId,
            canonicalNodeId,
            'ok',
          );
          this.stateService.setMetadata({
            adjacentNodes: cached.links,
            nearbyPOIs: pois,
            ...(cached.address ? { address: cached.address } : {}),
          });
        } else {
          this.stateService.setMetadata({ nearbyPOIs: pois });
        }
        this.stateService.setLoading(false);
        if (!this.stateService.showWelcome() && !this.stateService.showActivationDialog()) {
          this.descriptionService.needsRefresh(false);
        }
      },
      error: (err) => this.reportError(err, 'Location Error'),
    });
  }

  private land(params: {
    address?: string;
    imageId?: string;
    canonicalNodeId?: string;
    coordinates?: { latitude: number; longitude: number };
    heading: number;
  }) {
    this.viewSub?.unsubscribe();
    this.stateService.setLoading(true);
    this.viewSub = this.apiService.getView({
      canonicalNodeId: params.canonicalNodeId,
      imageId: params.imageId,
      address: params.address,
      coordinates: params.coordinates,
      heading: params.heading,
    }).subscribe({
      next: (view) => this.applyView(view, params),
      error: (err) => this.reportError(err, 'Location Error'),
    });
  }

  private applyView(
    view: GetViewResponse,
    params: { coordinates?: { latitude: number; longitude: number }; heading: number },
  ) {
    const nodeId = view.canonicalNodeId ?? null;
    const coords = view.coordinates ?? params.coordinates ?? null;
    this.stateService.setImage(view.image ?? null);
    if (view.actualHeading !== undefined && view.actualHeading !== null) {
      this.stateService.setHeading(view.actualHeading);
    }
    if (nodeId && coords) {
      this.stateService.updateLocation(
        coords.latitude,
        coords.longitude,
        view.imageId ?? null,
        nodeId,
        view.status ?? 'ok',
      );
    }

    const links = view.links ?? [];
    const address =
      view.address?.trim() ||
      this.streetLabelFromLinks(nodeId, links) ||
      'Unknown Address';
    this.cacheFromView(view, coords ?? undefined, address);
    this.stateService.setMetadata({ adjacentNodes: links, address });
    this.stateService.setLoading(false);

    if (coords) {
      const effectiveHeading =
        view.actualHeading !== undefined && view.actualHeading !== null
          ? view.actualHeading
          : params.heading;
      this.fetchNearbyPois(nodeId, coords.latitude, coords.longitude, effectiveHeading);
    }

    if (view.status === 'path_only' && view.message) {
      this.toastService.show(view.message);
    }
    if (!this.stateService.showWelcome() && !this.stateService.showActivationDialog()) {
      this.descriptionService.needsRefresh(false);
    }
  }

  private fetchNearbyPois(nodeId: string | null, lat: number, lng: number, heading: number) {
    this.poiSub?.unsubscribe();
    this.poiSub = this.apiService.getNearbyPlaces({ lat, lng, heading }).subscribe({
      next: (res) => {
        const places = res?.places ?? [];
        this.stateService.setMetadata({ nearbyPOIs: places });
        if (nodeId) {
          const cached = this.nodeCache.get(nodeId);
          if (cached) {
            cached.pois = places;
          }
        }
      },
      error: () => {
        this.stateService.setMetadata({ nearbyPOIs: [] });
      },
    });
  }

  private reorientPois(
    pois: NearbyPlace[],
    camLat: number,
    camLng: number,
    camHeading: number,
  ): NearbyPlace[] {
    return pois.map((poi) => {
      if (!poi.location) return poi;
      const dLon = ((poi.location.longitude - camLng) * Math.PI) / 180;
      const lat1 = (camLat * Math.PI) / 180;
      const lat2 = (poi.location.latitude * Math.PI) / 180;
      const y = Math.sin(dLon) * Math.cos(lat2);
      const x =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
      const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
      const diff = ((bearing - camHeading + 180) % 360) - 180;
      return {
        ...poi,
        relativePosition: {
          side: diff > 0 ? 'RIGHT' : 'LEFT',
          depth: Math.abs(diff) < 90 ? 'FRONT' : 'BEHIND',
        },
      };
    });
  }

  private streetLabelFromLinks(nodeId: string | null, links: Link[]): string | null {
    const streetNames = Array.from(
      new Set(
        links
          .map((l) => l.streetName?.trim())
          .filter((s): s is string => !!s && s.length > 0 && s !== 'Unnamed Street'),
      ),
    );
    if (streetNames.length === 0) {
      return null;
    }
    if (nodeId?.startsWith('osm_') && streetNames.length >= 2) {
      return `${streetNames[0]} & ${streetNames[1]}`;
    }
    return streetNames[0];
  }

  /** Cache the viewed (traversed) node so revisits replay identically. */
  private cacheFromView(
    view: GetViewResponse,
    coords?: { latitude: number; longitude: number },
    address?: string,
  ) {
    const nodeId = view.canonicalNodeId;
    const at = view.coordinates ?? coords;
    if (nodeId && at && view.links?.length) {
      this.nodeCache.set(nodeId, {
        links: view.links,
        imageId: view.imageId ?? null,
        lat: at.latitude,
        lng: at.longitude,
        address,
      });
    }
  }

  private reportError(err: unknown, title: string) {
    this.stateService.setLoading(false);
    const message =
      (err as { error?: { message?: string } })?.error?.message ??
      (err as { message?: string })?.message ??
      'Unknown error occurred.';
    this.dialog.open(ErrorDialogComponent, { data: { title, message }, width: '400px' });
  }
}
