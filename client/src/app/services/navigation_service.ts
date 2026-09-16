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
import { ApiService, GetViewResponse, Link } from './api_service';
import { StateService } from './state_service';
import { DescriptionService } from './description_service';
import { ToastService } from './toast_service';
import { MatDialog } from '@angular/material/dialog';
import { ErrorDialogComponent } from '../components/error_dialog/error_dialog';
import { forkJoin } from 'rxjs';

/** What we remember about a node we've already visited this session. The
 * server is stateless; this cache is the session. Nothing survives a page
 * reload — by design. */
interface CachedNode {
  links: Link[];
  imageId: string | null;
  lat: number;
  lng: number;
}

@Injectable({ providedIn: 'root' })
export class NavigationService {
  private apiService = inject(ApiService);
  private stateService = inject(StateService);
  private descriptionService = inject(DescriptionService);
  private toastService = inject(ToastService);
  private dialog = inject(MatDialog);

  private nodeCache = new Map<string, CachedNode>();

  /** Address entered manually. One request: the view endpoint geocodes,
   * anchors, and returns image + links together. */
  loadAddress(address: string) {
    this.land({ address, heading: this.stateService.currentHeading() });
  }

  /** Initial-boot address load with an explicit facing heading. */
  loadLocationWithHeading(address?: string, heading: number = 0) {
    this.land({ address, heading });
  }

  /** Navigate to a specific image id (deep link). */
  navigateToImage(imageId: string) {
    this.land({ imageId, heading: this.stateService.currentHeading() });
  }

  /** Move along an adjacency link. Arrival heading comes from the link itself
   * (the road tangent at the landing), so no server-side alignment is needed.
   * Previously-visited nodes render from the cache with an image-only request
   * and keep exactly the links they had — the session never shifts underfoot.
   * New nodes take a full request. */
  navigateToNode(node: Link) {
    const heading = node.arrivalHeading ?? node.heading;
    this.stateService.setHeading(heading);
    const cached = this.nodeCache.get(node.canonicalNodeId);
    const imageId = cached?.imageId ?? node.imageId ?? undefined;
    const fromCache = !!(cached?.links?.length && imageId);
    this.land({
      canonicalNodeId: node.canonicalNodeId,
      imageId,
      coordinates: node.coordinates,
      heading,
      imageOnly: fromCache,
      cachedLinks: cached?.links,
    });
  }

  /** Rotation / look: same node, new heading. If we've been here, this is a
   * pure image re-crop — no road or imagery fetches at all. */
  updateViewForHeading() {
    const loc = this.stateService.currentLocation();
    if (!loc.canonicalNodeId) return;
    const cached = this.nodeCache.get(loc.canonicalNodeId);
    this.land({
      canonicalNodeId: loc.canonicalNodeId,
      imageId: cached?.imageId ?? undefined,
      coordinates: { latitude: loc.lat, longitude: loc.lng },
      heading: this.stateService.currentHeading(),
      imageOnly: !!cached?.imageId,
      cachedLinks: cached?.links,
    });
  }

  // ---- the single load path ----

  private land(params: {
    address?: string;
    imageId?: string;
    canonicalNodeId?: string;
    coordinates?: { latitude: number; longitude: number };
    heading: number;
    imageOnly?: boolean;
    cachedLinks?: Link[];
  }) {
    this.stateService.setLoading(true);
    this.apiService.getView({
      canonicalNodeId: params.canonicalNodeId,
      imageId: params.imageId,
      address: params.address,
      coordinates: params.coordinates,
      heading: params.heading,
      imageOnly: params.imageOnly,
    }).subscribe({
      next: (view) => this.applyView(view, params),
      error: (err) => this.reportError(err, 'Location Error'),
    });
  }

  private applyView(view: GetViewResponse, params: { coordinates?: { latitude: number; longitude: number }; cachedLinks?: Link[]; heading: number }) {
    const nodeId = view.canonicalNodeId ?? null;
    const coords = view.panoramaMetadata?.coordinates ?? params.coordinates ?? null;
    this.stateService.setImage(view.image ?? null);
    if (view.actualHeading !== undefined && view.actualHeading !== null) {
      this.stateService.setHeading(view.actualHeading);
    }
    if (nodeId && coords) {
      this.stateService.updateLocation(coords.latitude, coords.longitude, view.name ?? null, nodeId, view.status ?? 'ok');
    }

    const links = view.links?.length ? view.links : (params.cachedLinks ?? []);
    this.cacheFromView(view, coords ?? undefined);
    // Links are usable immediately; address + POIs fill in right after.
    this.stateService.setMetadata({ adjacentNodes: links });
    this.stateService.setLoading(false);

    if (view.status === 'path_only' && view.message) {
      this.toastService.show(view.message);
    }
    if (!this.stateService.showWelcome() && !this.stateService.showActivationDialog()) {
      this.descriptionService.needsRefresh(false);
    }

    if (coords) {
      this.apiService.getAddress(coords.latitude, coords.longitude).subscribe({
        next: (address) => this.stateService.setMetadata({
          address: address?.address ?? 'Unknown Address',
        }),
        error: () => this.stateService.setMetadata({ address: 'Unknown Address' }),
      });
    }
  }

  /** Cache the viewed (traversed) node so revisits replay identically. */
  private cacheFromView(view: GetViewResponse, coords?: { latitude: number; longitude: number }) {
    const nodeId = view.canonicalNodeId;
    const at = view.panoramaMetadata?.coordinates ?? coords;
    if (nodeId && at && view.links?.length) {
      this.nodeCache.set(nodeId, {
        links: view.links,
        imageId: view.name ?? null,
        lat: at.latitude,
        lng: at.longitude,
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
