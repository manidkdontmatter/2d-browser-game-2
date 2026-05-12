// Coordinates client-side UI ownership so player-facing screens do not compete for input
// or stack over each other accidentally. Exclusive screens such as the main menu, future
// character sheets, maps, settings, or container views register here and are opened through
// a single authority. The controller derives gameplay-vs-UI input capture from visible UI
// state instead of requiring each overlay to manually manipulate input mode on its own.
import { ClientInputMode } from '../input.js';

export const enum ExclusiveUiScreen {
  MainMenu = 'main-menu',
}

export interface ExclusiveUiSurface {
  readonly screen: ExclusiveUiScreen;
  setOpen(open: boolean): void;
}

export interface UiStateControllerOptions {
  setInputMode: (mode: ClientInputMode) => void;
}

export class UiStateController {
  private readonly exclusiveSurfaces = new Map<ExclusiveUiScreen, ExclusiveUiSurface>();
  private readonly modalInputCaptures = new Set<string>();
  private activeExclusiveScreen: ExclusiveUiScreen | null = null;

  constructor(private readonly options: UiStateControllerOptions) {
    this.syncInputMode();
  }

  registerExclusiveSurface(surface: ExclusiveUiSurface): void {
    if (this.exclusiveSurfaces.has(surface.screen)) {
      throw new Error(`Duplicate exclusive UI surface registered for ${surface.screen}`);
    }

    this.exclusiveSurfaces.set(surface.screen, surface);
    surface.setOpen(this.activeExclusiveScreen === surface.screen);
  }

  getActiveExclusiveScreen(): ExclusiveUiScreen | null {
    return this.activeExclusiveScreen;
  }

  hasUiInputCapture(): boolean {
    return this.activeExclusiveScreen !== null || this.modalInputCaptures.size > 0;
  }

  handleGlobalKeyDown(event: KeyboardEvent): void {
    if (event.repeat) {
      return;
    }

    if (event.code === 'Backquote') {
      event.preventDefault();
      event.stopPropagation();
      this.toggleExclusiveScreen(ExclusiveUiScreen.MainMenu);
      return;
    }

    if (event.code === 'Escape' && this.activeExclusiveScreen !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.closeExclusiveScreen();
    }
  }

  toggleExclusiveScreen(screen: ExclusiveUiScreen): void {
    if (this.activeExclusiveScreen === screen) {
      this.closeExclusiveScreen(screen);
      return;
    }

    this.openExclusiveScreen(screen);
  }

  openExclusiveScreen(screen: ExclusiveUiScreen): void {
    const nextSurface = this.getExclusiveSurface(screen);

    if (this.activeExclusiveScreen !== null && this.activeExclusiveScreen !== screen) {
      this.getExclusiveSurface(this.activeExclusiveScreen).setOpen(false);
    }

    this.activeExclusiveScreen = screen;
    nextSurface.setOpen(true);
    this.syncInputMode();
  }

  closeExclusiveScreen(screen = this.activeExclusiveScreen): void {
    if (screen === null || this.activeExclusiveScreen !== screen) {
      return;
    }

    this.getExclusiveSurface(screen).setOpen(false);
    this.activeExclusiveScreen = null;
    this.syncInputMode();
  }

  beginModalInputCapture(id: string): void {
    this.modalInputCaptures.add(id);
    this.syncInputMode();
  }

  endModalInputCapture(id: string): void {
    this.modalInputCaptures.delete(id);
    this.syncInputMode();
  }

  private getExclusiveSurface(screen: ExclusiveUiScreen): ExclusiveUiSurface {
    const surface = this.exclusiveSurfaces.get(screen);
    if (!surface) {
      throw new Error(`No exclusive UI surface registered for ${screen}`);
    }
    return surface;
  }

  private syncInputMode(): void {
    this.options.setInputMode(this.hasUiInputCapture() ? ClientInputMode.Ui : ClientInputMode.Gameplay);
  }
}
