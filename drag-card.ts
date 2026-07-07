import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Shape of a standard Home Assistant tap/hold/ui-action config
interface HaActionConfig {
    action?: string;
    service?: string;
    perform_action?: string;
    data?: Record<string, any>;
    target?: { entity_id?: string | string[]; [key: string]: any };
    entity?: string | string[];
    navigation_path?: string;
    [key: string]: any;
}

// These are the variables that can be configured by the visual config and are edited by the card
interface DragCardConfig {
    actionUp?: HaActionConfig;
    actionDown?: HaActionConfig;
    actionLeft?: HaActionConfig;
    actionRight?: HaActionConfig;
    actionCenter?: HaActionConfig;
    actionHold?: HaActionConfig;
    actionDouble?: HaActionConfig;
    actionTriple?: HaActionConfig;
    actionQuadruple?: HaActionConfig;

    icoDefault?: string;
    icoUp?: string;
    icoRight?: string;
    icoDown?: string;
    icoLeft?: string;
    icoCenter?: string;
    icoHold?: string;
    icoDouble?: string;
    icoTriple?: string;
    icoQuadruple?: string;

    dragMode?: 'spring' | 'grid';
    gridX?: number;
    gridY?: number;

    lockNonActionDirs?: boolean;
    maxDrag?: number;                   // The maximum distance the button can be dragged in px
    returnTime?: number;                // Return animation duration in ms
    springDamping?: number;             // Controls how bouncy the spring is (>=2 -> switch to different function without bounce at all)

    repeatTime?: number;                // rapid fire interval time in ms
    holdTime?: number;                  // time until hold action gets activated in ms
    multiClickTime?: number;            // time between clicks to activate multi click in ms
    deadzone?: number;

    padding?: string;
    cardWidth?: string;
    cardHeight?: string;

    cardBackgroundColor?: string;
    cardBorderRadius?: string;
    cardBoxShadow?: string;
    cardBorder?: string;

    buttonWidth?: string;
    buttonHeight?: string;

    buttonBackgroundColor?: string;
    buttonBorderRadius?: string;
    buttonBoxShadow?: string;

    iconLargerOnClick?: boolean;
    buttonSmallerOnClick?: boolean;

    isStandalone?: boolean;

    iconSize?: string;
}

@customElement('drag-card')
export class DragCard extends LitElement {
    @property({ attribute: false }) 
    hass?: any;

    @state()
    private currentIcon = '';
    @state()
    private config!: DragCardConfig;
    @state()
    private isDragging = false;

    private startTime = 0;
    private buttonRealPos = { x: 0, y: 0 };             // "Real" position (without scaling)
    private mouseOffset = { x: 0, y: 0 };               // Mouse offset
    private buttonOrigin = { x: 0, y: 0 };              // Original position
    private lastGridX = 0;
    private lastGridY = 0;
    
    private overlay: HTMLElement | null = null;
    private buttonPlaceholder: HTMLElement | null = null;

    private distance = 0;
    private actionCounter = 0;
    private clickCount = 0;
    private maxMultiClicks = 1;
    private isHoldAction = false;
    private lastVibrate = 0;
    private hasVibratedOnce = false;

    private holdDetection: number | null = null;
    private repeatAction: number | null = null;
    private handleClick: number | null = null;
    private iconTimeout: number | null = null;
    private animationFrameID: number | null = null;
    private rippleTimeout: number | null = null;

    private button!: HTMLElement;
    private visualButton!: HTMLElement;
    private iconContainer!: HTMLElement;
    private hover!: HTMLElement;
    private ripple!: HTMLElement;

    private rippleTime = 300;

    private boundDragHandler = this.drag.bind(this);
    private boundEndDragHandler = this.endDrag.bind(this);
    private boundScrollHandler = this.onScroll.bind(this);

    protected firstUpdated() {
        this.button = this.shadowRoot!.querySelector('.drag-button') as HTMLElement;
        this.visualButton = this.button.querySelector('.drag-button-visual') as HTMLElement;
        this.iconContainer = this.button.querySelector('.icon-container') as HTMLElement;
        this.hover = this.button.querySelector('.hover') as HTMLElement;
        this.ripple = this.button.querySelector('.ripple') as HTMLElement;
        this.initOrigin();
    }

    // Here is the css - style part of the code
    static styles = css`
        ha-card {
            position: relative;
            padding: var(--drag-card-padding);
            height: var(--drag-card-height);
            width: var(--drag-card-width);

            background-color: var(--drag-card-background-color, var(--ha-card-background, var(--card-background-color)));
            border-radius: var(--drag-card-border-radius, var(--ha-card-border-radius));
            box-shadow: var(--drag-card-box-shadow, var(--ha-card-box-shadow));
            border: var(--drag-card-border, var(--ha-card-border-width,1px));

            display: flex;
            justify-content: center;
            align-items: center;
        }

        .grid-background {
            position: fixed;
            top: -100vh;
            left: -100vw;
            width: 300vw;
            height: 300vh;
            background-color: rgba(0, 0, 0, 0.4);
            background-image: 
                linear-gradient(to right, rgba(255, 255, 255, 0.5) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255, 255, 255, 0.5) 1px, transparent 1px);
            background-size: var(--grid-x) var(--grid-y);
            background-position: calc(var(--origin-x, 50%) - 0.5px + 100vw) calc(var(--origin-y, 50%) - 0.5px + 100vh);
            pointer-events: none;
            z-index: 999;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        

        .grid-background.active {
            opacity: 1;
        }

        .drag-button {
            position: relative;
            left: 0;
            top: 0;
            height: var(--drag-button-height);
            width: var(--drag-button-width);

            touch-action: none;
            z-index: 2;
            -webkit-tap-highlight-color: transparent;
            will-change: transform;
        }

        .drag-button-visual {
            height: 100%;
            width: 100%;
            position: relative;

            background-color: var(--drag-button-background-color, var(--ha-card-background, var(--card-background-color)));
            border-radius: var(--drag-button-border-radius, var(--ha-card-border-radius));
            box-shadow: var(--drag-button-box-shadow, var(--ha-card-box-shadow));

            transition: transform 0.1s ease;
            overflow: hidden;
            cursor: pointer;
        }

        .hover {
            left: 0;
            top: 0;
            position: absolute;
            width: 100%;
            height: 100%;
            background-color: rgb(255, 255, 255);
            opacity: 0;
            transition: opacity 0.1s ease;
        }
        @media (hover: hover) {
            .hover:hover {
                opacity: 0.01 !important;
            }
        }

        .ripple {
            left: 0;
            top: 0;
            position: absolute;
            border-radius: 50%;
            background-color: rgb(255, 255, 255);
            opacity: 0;
            pointer-events: none;
            /* offset-x offset-y softness shadow-size color */
            box-shadow: 0 0 40px 40px rgb(255, 255, 255);
            transform: scale(1);
        }
        
        .icon-container {
            display: flex;
            justify-content: center;
            align-items: center;
            width: 100%;
            height: 100%;
            transition: transform 0.1s ease;
        }

        .icon {
            width: var(--drag-card-icon-size);
            height: var(--drag-card-icon-size);
            --mdc-icon-size: 100%;
        }

        .image {
            object-fit: contain;
            width: var(--drag-card-icon-size);
            height: var(--drag-card-icon-size);
        }
    `;

    // Default configuration for values that are not modified by the user
    // This method is called when:
    //   1. The card is first loaded with its configuration
    //   2. The configuration is updated (e.g., through the card editor)
    //   3. The card is restored from the dashboard

    public setConfig(config: DragCardConfig) {
        if (!config) throw new Error('Invalid configuration');

        this.config = {
            dragMode: 'spring',
            gridX: 50,
            gridY: 50,
            maxDrag: 100,
            returnTime: 200,
            springDamping: 2,
            repeatTime: 200,
            holdTime: 800,
            multiClickTime: 300,
            deadzone: 20,
            lockNonActionDirs: true,
            iconLargerOnClick: false,
            buttonSmallerOnClick: true,
            isStandalone: true,
            ...config
        };

        this.style.setProperty('--drag-card-padding', this.config.padding ?? (this.config.isStandalone ? '15px' : '0px'));
        this.style.setProperty('--drag-card-width', this.config.cardWidth ?? '100%');
        this.style.setProperty('--drag-card-height', this.config.cardHeight ?? '100%');
        this.style.setProperty('--drag-button-width', this.config.buttonWidth ?? '100%');
        this.style.setProperty('--drag-button-height', this.config.buttonHeight ?? '100%');
        this.style.setProperty('--drag-card-icon-size', this.config.iconSize ?? '80%');

        const cssMapping: Record<string, string> = {
            cardBackgroundColor: '--drag-card-background-color',
            cardBorderRadius: '--drag-card-border-radius',
            cardBoxShadow: '--drag-card-box-shadow',
            buttonBackgroundColor: '--drag-button-background-color',
            buttonBorderRadius: '--drag-button-border-radius',
            buttonBoxShadow: '--drag-button-box-shadow',
        };

        for (const [configKey, cssVar] of Object.entries(cssMapping)) {
            const value = this.config[configKey as keyof DragCardConfig];
            if (value) {
                this.style.setProperty(cssVar, value as string);
            }
        }

        if (this.config.isStandalone == false) {
            this.style.setProperty('--drag-card-background-color', 'transparent');
            this.style.setProperty('--drag-card-box-shadow', 'none');
            this.style.setProperty('--drag-card-border', '0px');
        }
        
        this.currentIcon = this.config.icoDefault || "";

        // Calculate maxMultiClicks based on configured entities
        this.maxMultiClicks = 1; // Default to single click
        if (this.hasAction('Quadruple')) {
            this.maxMultiClicks = 4;
        } else if (this.hasAction('Triple')) {
            this.maxMultiClicks = 3;
        } else if (this.hasAction('Double')) {
            this.maxMultiClicks = 2;
        }

        this.initOrigin()
    }

    // This is the render part (html) here the main structure of the card is defined
    protected render(): TemplateResult {
        if (!this.config) return html`<div>No configuration</div>`;

        const content = html`
            ${this.config.dragMode === 'grid' ? html`<div class="grid-background ${this.isDragging ? 'active' : ''}" style="--grid-x: ${this.config.gridX || 50}px; --grid-y: ${this.config.gridY || 50}px; --origin-x: ${this.buttonOrigin.x}px; --origin-y: ${this.buttonOrigin.y}px;"></div>` : ''}
            <div class="drag-button"
                @pointerdown=${this.startDrag}
                @pointerup=${(e: Event) => {
                    e.stopPropagation();
                    if (this.isDragging) this.endDrag();
                }}
                @pointercancel=${(e: Event) => {
                    e.stopPropagation();
                    if (this.isDragging) this.endDrag();
                }}
                @click=${(e: Event) => { e.stopPropagation(); e.preventDefault(); }}>
                <div class="drag-button-visual">         
                    <div class="icon-container">
                        ${this.renderIcon()}
                   </div>
                    <div class="hover"></div>
                    <div class="ripple"></div>
                </div>
            </div>
        `;

        return html`<ha-card>${content}</ha-card>`;
    }

    private renderIcon(): TemplateResult {
        if (!this.currentIcon) return html``;
        
        return this.currentIcon.startsWith("/local/") 
            ? html`<img class="image" src=${this.currentIcon} alt="Image"></img>`
            : html`<ha-icon class="icon" .icon=${this.currentIcon}></ha-icon>`;
    }

    private initOrigin() {
        if (!this.button) return;
        const rect = this.button.getBoundingClientRect();
        this.buttonOrigin = { 
            x: rect.left + rect.width/2, 
            y: rect.top + rect.height/2 }; 
        this.buttonRealPos = { 
            x: this.buttonOrigin.x, 
            y: this.buttonOrigin.y };
        }
    
    private updateDynamicOrigin() {
        if (this.buttonPlaceholder) {
            const rect = this.buttonPlaceholder.getBoundingClientRect();
            const newOrigin = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };
            
            if (this.buttonOrigin.x !== 0 || this.buttonOrigin.y !== 0) {
                const deltaX = newOrigin.x - this.buttonOrigin.x;
                const deltaY = newOrigin.y - this.buttonOrigin.y;
                if (deltaX !== 0 || deltaY !== 0) {
                    this.buttonRealPos.x += deltaX;
                    this.buttonRealPos.y += deltaY;
                    this.mouseOffset.x -= deltaX;
                    this.mouseOffset.y -= deltaY;
                }
            }

            this.buttonOrigin = newOrigin;
            
            if (this.button && this.button.style.position === 'fixed') {
                this.button.style.left = `${rect.left}px`;
                this.button.style.top = `${rect.top}px`;
            }
            
            if (this.config?.dragMode === 'grid') {
                const gridBg = this.shadowRoot?.querySelector('.grid-background') as HTMLElement;
                if (gridBg) {
                    gridBg.style.setProperty('--origin-x', `${this.buttonOrigin.x}px`);
                    gridBg.style.setProperty('--origin-y', `${this.buttonOrigin.y}px`);
                }
            }
        }
    }

    /*##################################################
    #                                                  #
    #           Start of the drag action               #
    #                                                  #
    ##################################################*/

    // This function is called when the mouse or touch is pressed down
    // It sets the initial position and starts the drag action
    private startDrag(event: any) {
        if (this.isDragging) return; // Prevent multi-touch digitizer confusion

        event.stopPropagation(); // Stop parent cards from feeling the touch and firing duplicate haptics
        
        if (event.pointerId !== undefined) {
            try {
                this.button.setPointerCapture(event.pointerId);
            } catch (e) {}
        }

        if (this.config.buttonSmallerOnClick) this.visualButton.style.transform = "scale(0.95)";
        if (this.config.iconLargerOnClick) this.iconContainer.style.transform = "scale(1.1)";
        if (event.pointerType != 'touch') this.hover.style.opacity = "0.01";

        this.startTime = Date.now();
        this.isDragging = true;

        if (this.rippleTimeout) {
            clearTimeout(this.rippleTimeout);
            this.rippleTimeout = null;
        }

        // Cancel any ongoing return animation
        if (this.animationFrameID) {
            cancelAnimationFrame(this.animationFrameID);
            this.animationFrameID = null;
        }
        
        const actualRect = this.button.getBoundingClientRect();
        
        let originRect;
        if (this.buttonPlaceholder && this.buttonPlaceholder.parentNode) {
            originRect = this.buttonPlaceholder.getBoundingClientRect();
        } else {
            originRect = actualRect;
        }
        
        const buttonWidth = originRect.width;
        const buttonHeight = originRect.height;

        if (!this.overlay) {
            this.overlay = document.createElement('div');
            const shadow = this.overlay.attachShadow({ mode: 'open' });
            if (this.shadowRoot?.adoptedStyleSheets) {
                shadow.adoptedStyleSheets = this.shadowRoot.adoptedStyleSheets;
            }
            const styleNode = this.shadowRoot?.querySelector('style');
            if (styleNode) {
                shadow.appendChild(styleNode.cloneNode(true));
            }
        }
        
        this.overlay.style.cssText = this.style.cssText;
        this.overlay.style.position = 'fixed';
        this.overlay.style.top = '0';
        this.overlay.style.left = '0';
        this.overlay.style.width = '100%';
        this.overlay.style.height = '100%';
        this.overlay.style.pointerEvents = 'none';
        this.overlay.style.zIndex = '999999';

        if (!this.buttonPlaceholder) {
            this.buttonPlaceholder = document.createElement('div');
        }
        this.buttonPlaceholder.style.width = `${buttonWidth}px`;
        this.buttonPlaceholder.style.height = `${buttonHeight}px`;
        
        if (this.button.parentNode !== this.overlay.shadowRoot) {
            this.button.parentNode?.insertBefore(this.buttonPlaceholder, this.button);
            this.overlay.shadowRoot!.appendChild(this.button);
            if (!this.overlay.parentNode) {
                document.body.appendChild(this.overlay);
            }
        }

        this.button.style.position = 'fixed';
        this.button.style.left = `${originRect.left}px`;
        this.button.style.top = `${originRect.top}px`;
        this.button.style.margin = '0';
        this.button.style.width = `${buttonWidth}px`;
        this.button.style.height = `${buttonHeight}px`;
        this.button.style.pointerEvents = 'auto';

        this.buttonOrigin = { 
            x: originRect.left + buttonWidth/2, 
            y: originRect.top + buttonHeight/2 
        }; 
        
        this.buttonRealPos = {
            x: actualRect.left + actualRect.width/2,
            y: actualRect.top + actualRect.height/2
        };

        // Get the mouse/finger position relative to the doc
        const mouseDocument = {
            x: event.clientX,
            y: event.clientY };

        this.mouseOffset = {
            x: mouseDocument.x - this.buttonRealPos.x,
            y: mouseDocument.y - this.buttonRealPos.y };

        // Get the mouse/finger position relative to the button
        const mouseButton = {
            x: mouseDocument.x - actualRect.left,
            y: mouseDocument.y - actualRect.top };

        // Set ripple start radius to 10% of longer side
        let rippleRadius = 0;
        if (buttonWidth < buttonHeight) rippleRadius = buttonHeight * 0.1;
        else rippleRadius = buttonWidth * 0.1;
        this.ripple.style.left = mouseButton.x - rippleRadius + 'px';
        this.ripple.style.top = mouseButton.y - rippleRadius + 'px';
        this.ripple.style.width = rippleRadius*2 + 'px';
        this.ripple.style.height = rippleRadius*2 + 'px';

        // Get distance to furthest corner (Set ripple end radius)
        let distCorner: number;
        if (mouseButton.x > buttonWidth/2){
            if (mouseButton.y > buttonHeight/2) distCorner = Math.sqrt((mouseButton.x) **2 + (mouseButton.y) ** 2); //top left
            else distCorner = Math.sqrt((mouseButton.x) **2 + (buttonHeight - mouseButton.y) ** 2); //buttom left
        } else {
            if (mouseButton.y > buttonHeight/2) distCorner = Math.sqrt((buttonWidth - mouseButton.x) **2 + (mouseButton.y) ** 2); //top right
            else distCorner = Math.sqrt((buttonWidth - mouseButton.x) **2 + (buttonHeight - mouseButton.y) ** 2); //bottom right
        }
        let newScale = distCorner/rippleRadius;

        // Reset ripple scale without transition
        this.ripple.style.transition = 'none';
        this.ripple.style.transform = 'scale(1)';
        this.ripple.style.opacity = '0.02';
        
        // Force a reflow to ensure the reset is applied before the next change
        void this.ripple.offsetHeight;
        
        // Reapply transition and set new scale
        this.ripple.style.transition = 'transform ' + this.rippleTime + 'ms ease-in, opacity 0.3s';
        this.ripple.style.transform = 'scale(' + newScale + ')';
        this.ripple.style.opacity = '0.04';

        document.addEventListener('pointermove', this.boundDragHandler, { capture: true });
        document.addEventListener('pointerup', this.boundEndDragHandler, { capture: true });
        document.addEventListener('pointercancel', this.boundEndDragHandler, { capture: true });
        window.addEventListener('scroll', this.boundScrollHandler, { capture: true, passive: true });

        this.actionCounter = 0;
        this.lastGridX = 0;
        this.lastGridY = 0;
        this.distance = 0; // Guarantee fresh distance so previous swipes don't block holds
        this.isHoldAction = false;

        if (this.repeatAction) clearInterval(this.repeatAction);
        if (this.holdDetection) clearTimeout(this.holdDetection);

        this.holdDetection = window.setTimeout(() => {
            if (this.actionCounter > 0) return;

            this.isHoldAction = true;
            // Set repeat action FIRST so if detectSwipeDirection calls endDrag, it gets properly cleared!
            if (this.config.dragMode !== 'grid') {
                this.repeatAction = window.setInterval(() => {
                    this.detectSwipeDirection((this.config.deadzone!) * 2, 1);
                }, this.config.repeatTime!);
            }
            this.detectSwipeDirection((this.config.deadzone!) * 2, 1);
        }, this.config.holdTime!);
    }

    // This function is called when the mouse or touch is moved
    // It calculates the distance moved and updates the position of the button
    private drag(event: any) {        
        event.preventDefault();
        event.stopPropagation();
        document.body.style.cursor = 'grabbing';
        this.visualButton.style.cursor = 'grabbing';

        // Get the mouse/finger position relative to the doc
        const mouseDocument = { x: event.clientX, y: event.clientY };
        
        // Update real position (without scaling)
        this.buttonRealPos = { x: mouseDocument.x - this.mouseOffset.x,
                               y: mouseDocument.y - this.mouseOffset.y };
        
        this.updateVisualPosition();
    }

    private onScroll() {
        if (this.isDragging || this.animationFrameID) {
            this.updateDynamicOrigin();
            if (this.isDragging) this.updateVisualPosition();
        }
    }

    private updateVisualPosition() {
        // Calculate distance from origin
        const d = { x: this.buttonRealPos.x - this.buttonOrigin.x,
                    y: this.buttonRealPos.y - this.buttonOrigin.y };

        this.distance = Math.sqrt(d.x*d.x + d.y*d.y);

        let visualX = d.x;
        let visualY = d.y;

        // Enforce boundary lock visually while keeping raw physics intact
        if (this.config.lockNonActionDirs) {
            if ((visualY > 0 && !this.hasAction('Down')) || (visualY < 0 && !this.hasAction('Up'))) {
                visualY = 0;
            }
            if ((visualX > 0 && !this.hasAction('Right')) || (visualX < 0 && !this.hasAction('Left'))) {
                visualX = 0;
            }
        }

        if (this.config.dragMode === 'grid') {
            const gridX = Math.max(1, this.config.gridX || 50);
            const gridY = Math.max(1, this.config.gridY || 50);

            const calcVisual = (pos: number, grid: number) => {
                const stickyRadius = grid * 0.4; // 40% sticky zone around grid line
                const nearest = Math.round(Math.abs(pos) / grid) * grid * (pos < 0 ? -1 : 1);
                const dist = pos - nearest;
                if (Math.abs(dist) < stickyRadius) {
                    return nearest + dist * 0.1; // Move only 10% locally within sticky bounds
                } else {
                    const sign = Math.sign(dist);
                    const excess = Math.abs(dist) - stickyRadius;
                    const nonStickyZone = (grid / 2) - stickyRadius;
                    const startingPoint = stickyRadius * 0.1;
                    const progress = excess / nonStickyZone;
                    return nearest + sign * (startingPoint + progress * ((grid / 2) - startingPoint));
                }
            };

            const lockedX = visualX;
            const lockedY = visualY;

            visualX = calcVisual(lockedX, gridX);
            visualY = calcVisual(lockedY, gridY);
            
            let currentGridX = this.lastGridX;
            let currentGridY = this.lastGridY;

            const idealGridX = Math.round(lockedX / gridX);
            const idealGridY = Math.round(lockedY / gridY);

            // Add 15% hysteresis buffer to prevent fluttering on grid lines (double clicks)
            const bufferX = gridX * 0.15;
            const bufferY = gridY * 0.15;

            if (idealGridX !== this.lastGridX) {
                const boundaryX = (idealGridX + this.lastGridX) / 2 * gridX;
                if (lockedX > boundaryX + bufferX || lockedX < boundaryX - bufferX) {
                    currentGridX = idealGridX;
                }
            }

            if (idealGridY !== this.lastGridY) {
                const boundaryY = (idealGridY + this.lastGridY) / 2 * gridY;
                if (lockedY > boundaryY + bufferY || lockedY < boundaryY - bufferY) {
                    currentGridY = idealGridY;
                }
            }

            if (currentGridX > this.lastGridX) {
                for(let i=0; i < currentGridX - this.lastGridX; i++) this.triggerDirectionAction('right');
            } else if (currentGridX < this.lastGridX) {
                for(let i=0; i < this.lastGridX - currentGridX; i++) this.triggerDirectionAction('left');
            }

            if (currentGridY > this.lastGridY) {
                for(let i=0; i < currentGridY - this.lastGridY; i++) this.triggerDirectionAction('down');
            } else if (currentGridY < this.lastGridY) {
                for(let i=0; i < this.lastGridY - currentGridY; i++) this.triggerDirectionAction('up');
            }

            this.lastGridX = currentGridX;
            this.lastGridY = currentGridY;
        } else {
            // Apply resistance
            const scale = this.config.maxDrag! / (this.config.maxDrag! + this.distance);
            visualX = visualX * scale;
            visualY = visualY * scale;
        }

        // Update displayed position with scaling
        this.updatePosition(visualX, visualY);
    }
    
    private getDirectionFromDelta(dx: number, dy: number): 'Up' | 'Down' | 'Left' | 'Right' {
        if (Math.abs(dx) > Math.abs(dy)) {
            return dx > 0 ? 'Right' : 'Left';
        }
        return dy > 0 ? 'Down' : 'Up';
    }

    private hasAction(key: 'Up' | 'Down' | 'Left' | 'Right' | 'Center' | 'Hold' | 'Double' | 'Triple' | 'Quadruple'): boolean {
        if (!this.config) return false;
        const actionConfig = this.config[`action${key}` as keyof DragCardConfig] as HaActionConfig | undefined;
        return !!(actionConfig && actionConfig.action && actionConfig.action !== 'none');
    }

    private fireHapticEvent() {
        const hapticEvent = new Event('haptic', { bubbles: true, composed: true });
        (hapticEvent as any).detail = 'light';
        this.dispatchEvent(hapticEvent);
    }

    private executeAction(actionKey: keyof DragCardConfig) {
        if (!this.config || !this.hass) return;
        
        const actionConfig = this.config[actionKey] as HaActionConfig | undefined;
        const hasValidAction = !!(actionConfig && actionConfig.action && actionConfig.action !== 'none');
        
        if (hasValidAction) {
            const now = Date.now();
            // 100ms cooldown prevents rapid-fire double clicks on simultaneous grid crosses
            if (now - this.lastVibrate > 100) {
                if (navigator.vibrate && this.hasVibratedOnce) {
                    // Subsequent actions: Use native web API for crisp, non-doubling feedback
                    navigator.vibrate(40);
                } else {
                    // First action or unsupported devices: Use HA native event to bypass strict browser blocks
                    this.fireHapticEvent();
                }

                this.lastVibrate = now;
            }

            // Manually execute the action to bypass Home Assistant's mandatory haptic feedback
            let handled = false;
            try {
                const action = actionConfig.action;
                if (action === 'call-service' || action === 'perform-action') {
                    const service = actionConfig.service || actionConfig.perform_action;
                    if (service) {
                        const [domain, serviceName] = service.split('.');
                        const data = { ...(actionConfig.data || {}), ...(actionConfig.target || {}) };
                        this.hass.callService(domain, serviceName, data);
                        handled = true;
                    }
                } else if (action === 'toggle' || action === 'turn_on' || action === 'turn_off') {
                    let entityId = actionConfig.entity || (actionConfig.target ? actionConfig.target.entity_id : null);
                    if (Array.isArray(entityId)) entityId = entityId[0]; // Extract if list
                    
                    if (entityId) {
                        const domain = entityId.split('.')[0];
                        let service = action;
                        if (action === 'toggle' && domain === 'button') service = 'press';
                        else if (action === 'toggle' && domain === 'script') service = 'turn_on';
                        else if (action === 'toggle' && domain === 'scene') service = 'turn_on';
                        
                        this.hass.callService(domain, service, { entity_id: entityId });
                        handled = true;
                    }
                } else if (action === 'navigate') {
                    const path = actionConfig.navigation_path;
                    if (path) {
                        window.history.pushState(null, '', path);
                        window.dispatchEvent(new CustomEvent('location-changed'));
                        handled = true;
                    }
                } else if (action === 'none') {
                    handled = true;
                }
            } catch (e) {
                console.warn("Drag-Card: Failed to manually execute action", e);
            }

            // Fallback only if the custom execution wasn't able to handle the action type
            if (!handled) {
                const modifiedActionConfig = { ...actionConfig, haptic: 'none' };
                const event = new Event('hass-action', { bubbles: true, composed: true });
                (event as any).detail = { config: { tap_action: modifiedActionConfig }, action: 'tap' };
                this.dispatchEvent(event);
            }
        }
    }
    
    private triggerDirectionAction(direction: 'up' | 'down' | 'left' | 'right') {
        if (!this.config || !this.hass) return;
        if (this.iconTimeout) clearTimeout(this.iconTimeout);

        const dirCapitalized = direction.charAt(0).toUpperCase() + direction.slice(1) as 'Up' | 'Down' | 'Left' | 'Right';
        if (this.hasAction(dirCapitalized)) {
            this.runNamedAction(dirCapitalized);
        }

        this.scheduleIconReset();
    }

    // Runs the icon/action pair for a named action slot (e.g. 'Up', 'Hold', 'Double')
    private runNamedAction(key: 'Up' | 'Down' | 'Left' | 'Right' | 'Hold' | 'Center' | 'Double' | 'Triple' | 'Quadruple') {
        const iconKey = `ico${key}` as keyof DragCardConfig;
        const actionKey = `action${key}` as keyof DragCardConfig;
        this.currentIcon = (this.config[iconKey] as string) || this.currentIcon;
        this.executeAction(actionKey);
    }

    // Resets the displayed icon back to default after a short delay
    private scheduleIconReset() {
        this.actionCounter++;
        this.iconTimeout = window.setTimeout(() => {
            this.currentIcon = this.config?.icoDefault || this.config?.icoCenter || 'mdi:alert';
        }, 3000);
    }


    // This function detects the swipe direction/multi-click and changes the icon
    // It also triggers callService() for the configured entity
    private detectSwipeDirection(deadzone: number, holdMode: number) {
        //console.log("detectSwipeDirection")
        if (!this.config || !this.hass) return;

        if (this.iconTimeout) clearTimeout(this.iconTimeout);

        if (holdMode == 1) {
            if (this.distance < deadzone) {
                if (this.hasAction('Hold')) {
                    this.runNamedAction('Hold');
                }

                this.scheduleIconReset();
                this.endDrag();
            } else {
                const dx = this.buttonRealPos.x - this.buttonOrigin.x;
                const dy = this.buttonRealPos.y - this.buttonOrigin.y;

                const direction = this.getDirectionFromDelta(dx, dy);

                if (this.hasAction(direction)) {
                    this.runNamedAction(direction);
                }

                this.scheduleIconReset();
            }
            return; // ALWAYS return for holdMode 1 to prevent accidental swipe executions
        }

        if (this.distance < deadzone) {
            if (holdMode == 0) {
                this.clickCount++;
                if (this.handleClick) clearTimeout(this.handleClick);

                const triggerClick = () => {
                    if (this.isDragging) { // Cancel pending clicks if user is currently holding down a new press
                        this.clickCount = 0;
                        this.handleClick = null;
                        return;
                    }
                    const clickKeys: Record<number, 'Center' | 'Double' | 'Triple' | 'Quadruple'> = {
                        1: 'Center', 2: 'Double', 3: 'Triple', 4: 'Quadruple'
                    };
                    const clickKey = clickKeys[this.clickCount];
                    if (clickKey) {
                        this.executeAction(`action${clickKey}` as keyof DragCardConfig);
                        this.currentIcon = (this.config[`ico${clickKey}` as keyof DragCardConfig] as string) || '';
                    }
                    this.clickCount = 0;
                    this.handleClick = null;
                };

                if (this.clickCount === this.maxMultiClicks) {
                    triggerClick();
                } else {
                    this.handleClick = window.setTimeout(triggerClick, this.config.multiClickTime!);
                }
            }
        } else {
            const dx = this.buttonRealPos.x - this.buttonOrigin.x;
            const dy = this.buttonRealPos.y - this.buttonOrigin.y;

            const direction = this.getDirectionFromDelta(dx, dy);

            if (this.hasAction(direction)) {
                this.runNamedAction(direction);
            }
        }

        this.scheduleIconReset();
    }

    // This function is called when the mouse or touch is released
    // It resets the button position and stops the drag action
    private endDrag() {
        if (!this.isDragging) return; // Prevent double execution

        // The browser unlocks the vibration API after the first complete user interaction.
        // We prime it here upon release, so all subsequent drags use the crisp native web API.
        if (!this.hasVibratedOnce && navigator.vibrate) {
            navigator.vibrate(1);
            this.hasVibratedOnce = true;
        }

        this.isDragging = false;
        document.body.style.cursor = '';
        this.visualButton.style.cursor = 'pointer';
        if (this.config.buttonSmallerOnClick) this.visualButton.style.transform = "scale(1)";
        if (this.config.iconLargerOnClick) this.iconContainer.style.transform = "scale(1)";
        this.hover.style.opacity = "0";

        if (Date.now() - this.startTime >= this.rippleTime) {
            this.ripple.style.opacity = '0';
        } else {
            this.rippleTimeout = window.setTimeout(() => {
                this.ripple.style.opacity = '0';
            }, this.rippleTime - (Date.now() - this.startTime));
        }

        document.removeEventListener('pointermove', this.boundDragHandler, { capture: true });
        document.removeEventListener('pointerup', this.boundEndDragHandler, { capture: true });
        document.removeEventListener('pointercancel', this.boundEndDragHandler, { capture: true });
        
        if (this.isHoldAction == false) {
            if (this.config.dragMode === 'grid') {
                if (this.distance < this.config.deadzone! && this.actionCounter === 0) {
                    this.detectSwipeDirection(this.config.deadzone!, 0);
                }
            } else {
                this.detectSwipeDirection(this.config.deadzone!, 0);
            }
        }

        if (this.repeatAction) clearInterval(this.repeatAction); 
        if (this.holdDetection) clearTimeout(this.holdDetection);

        this.updateDynamicOrigin();

        // Animate return if not at origin
        if (this.buttonRealPos.x !== this.buttonOrigin.x || this.buttonRealPos.y !== this.buttonOrigin.y) {
            this.animateReturn();
        } else {
            this.cleanupDrag();
        }
    }

    // This function animates the button back to the center of the card
    private animateReturn() {
        const startD = { x : this.buttonRealPos.x - this.buttonOrigin.x,
                         y : this.buttonRealPos.y - this.buttonOrigin.y };
        const startTime = performance.now();

        const animate = (timestamp: number) => {
            // Check if we're still supposed to animate (might have been interrupted by new drag)
            if (!this.animationFrameID) return;

            const elapsed = timestamp - startTime;
            const progress = Math.max(0, Math.min(elapsed / this.config.returnTime!, 1));
            
            let eased: number = 0;
            // Spring easing - starts fast and ends with a gentle settle
            if (this.config.springDamping! >= 2) {
                // without bounce
                eased = 1 - Math.pow(1 - progress, 1.675);
            }
            else {
                //spring like
                eased = 1 - Math.pow(2, -10 * progress) * Math.cos(progress * Math.PI * 2 / this.config.springDamping!);
            }
            
            // Update real position relative to origin
            this.buttonRealPos = { x : this.buttonOrigin.x + startD.x * (1 - eased),
                                   y : this.buttonOrigin.y + startD.y * (1 - eased) };
            
            // Calculate distance from origin
            const d = { x: this.buttonRealPos.x - this.buttonOrigin.x,
                        y: this.buttonRealPos.y - this.buttonOrigin.y};
            this.distance = Math.sqrt(d.x*d.x + d.y*d.y);

            let visualX = d.x;
            let visualY = d.y;
            if (this.config.lockNonActionDirs) {
                if ((visualY > 0 && !this.hasAction('Down')) || (visualY < 0 && !this.hasAction('Up'))) {
                    visualY = 0;
                }
                if ((visualX > 0 && !this.hasAction('Right')) || (visualX < 0 && !this.hasAction('Left'))) {
                    visualX = 0;
                }
            }

            if (this.config.dragMode !== 'grid') {
                const scale = this.config.maxDrag! / (this.config.maxDrag! + this.distance);
                visualX = visualX * scale;
                visualY = visualY * scale;
            }
            this.updatePosition(visualX, visualY);

            if (progress < 1) {
                this.animationFrameID = requestAnimationFrame(animate);
            } else {
                this.cleanupDrag();
            }
        }
        this.animationFrameID = requestAnimationFrame(animate);
    }

    private cleanupDrag() {
        window.removeEventListener('scroll', this.boundScrollHandler, { capture: true });

        if (this.buttonPlaceholder && this.buttonPlaceholder.parentNode) {
            this.buttonPlaceholder.parentNode.insertBefore(this.button, this.buttonPlaceholder);
            this.buttonPlaceholder.remove();
        }
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.remove();
        }
        
        this.button.style.position = '';
        this.button.style.left = '';
        this.button.style.top = '';
        this.button.style.margin = '';
        this.button.style.width = '';
        this.button.style.height = '';
        this.button.style.pointerEvents = '';
        
        this.updatePosition(0, 0);
        this.initOrigin();
    }

    private updatePosition(x: number, y: number) {
        // Update displayed position with scaling applied
        this.button.style.transform = `translate(${x}px, ${y}px)`;
    }

    // Required by Lovelace to show configuration UI
    public static getConfigElement() {
        return document.createElement("drag-card-editor");
    }

    // Default configuration for new cards with all the default values for variables
    public static getStubConfig(): Partial<DragCardConfig> {
        return {
            actionUp: { action: 'toggle' },
            actionDown: { action: 'toggle' },
            actionLeft: { action: 'toggle' },
            actionRight: { action: 'toggle' },
            actionCenter: { action: 'toggle' },
            icoDefault: 'mdi:drag-variant',
            icoUp: 'mdi:chevron-up',
            icoDown: 'mdi:chevron-down',
            icoLeft: 'mdi:chevron-left',
            icoRight: 'mdi:chevron-right',
            icoCenter: 'mdi:circle-medium',
        };
    }
}













/*##################################################
#                                                  #
#               Drag-Card Editor                   #
#                                                  #
##################################################*/

// This is the support class for the visual configuration editor
@customElement('drag-card-editor')
export class DragCardEditor extends LitElement {
    @property({ attribute: false }) hass?: any;
    @property({ attribute: false }) config?: DragCardConfig;

    static styles = css`
        .tab {
            border: 1px solid var(--divider-color);
            border-radius: 4px;
            margin-bottom: 16px;
        }
        .tab-label {
            display: flex;
            justify-content: space-between;
            padding: 1em;
            cursor: pointer;
            font-weight: bold;
            background-color: var(--secondary-background-color);
        }
        .tab-content { 
            padding: 1em;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .grid-2-col {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px 16px;
        }
        ha-selector, ha-icon-picker {
            display: block;
            margin: 0 !important;
        }
        /* Target selectors in compact layouts to clip their internal margins */
        .grid-2-col > ha-selector,
        .grid-2-col > ha-icon-picker,
        .advanced-tab-content > ha-selector {
            /* Clip the built-in 16px bottom margin from internal textfields */
            max-height: 56px;
            overflow: hidden;
        }
        ha-selector.select-selector {
            max-height: none !important;
            overflow: visible !important;
        }
        ha-selector.checkbox-selector {
            max-height: 40px !important;
        }
        @media (max-width: 450px) {
            .grid-2-col {
                display: flex; /* Fall back to single column on mobile */
                flex-direction: column;
            }
        }
    `;

    public setConfig(config: DragCardConfig) {
        this.config = config;
    }

    // This funciton gets called when anything about the config gets changed
    private _valueChanged(event: Event) {
        if (!this.config || !this.hass) return;
        const target = event.target as any;
        const configKey = target.configValue as keyof DragCardConfig;
        if (!configKey) return;
        
        // List of numeric configuration keys
        const numericKeys = [
            'maxDrag', 'returnTime', 'springDamping', 'repeatTime', 
            'holdTime', 'multiClickTime', 'deadzone', 'gridX', 'gridY'
        ];

        // Get the value, checking for empty string
        let value: any;
        if ('checked' in target) {
            value = target.checked;
        } else {
            value = (event as CustomEvent).detail?.value ?? target.value;
            // Convert empty string to undefined
            if (value == "" || value == " " || value == "none" || value == "-") { value = undefined; }
            // Convert to number if this is a numeric field
            else if (numericKeys.includes(configKey)) { value = Number(value); }

        }

        if (this.config[configKey] === value) return;
        const newConfig = { ...this.config, [configKey]: value };
        this.config = newConfig;
        this.requestUpdate();
        this.dispatchEvent(new CustomEvent('config-changed', {
            detail: { config: newConfig },
            bubbles: true,
            composed: true,
        }));
    }      
      
    // This is the html structure for the visual configuration editor
    protected render(): TemplateResult {
        if (!this.config || !this.hass) return html`<div>No configuration</div>`;

        return html`
            <div class="config-container">
                <div class="tab">
                    <div class="tab-label">Visuals</div>
                    <div class="tab-content grid-2-col">
                        ${this.renderTextInput('padding', 'Padding')}
                        ${this.renderTextInput('cardWidth', 'Card Width')}
                        ${this.renderTextInput('cardHeight', 'Card Height')}
                        ${this.renderTextInput('cardBackgroundColor', 'Background Color')}
                        ${this.renderTextInput('cardBorderRadius', 'Border Radius')}
                        ${this.renderTextInput('cardBoxShadow', 'Box Shadow')} 

                        ${this.renderTextInput('buttonHeight', 'Button Height')}
                        ${this.renderTextInput('buttonWidth', 'Button Width')}
                        ${this.renderTextInput('buttonBackgroundColor', 'Button Background Color')}
                        ${this.renderTextInput('buttonBorderRadius', 'Button Border Radius')}
                        ${this.renderTextInput('buttonBoxShadow', 'Button Box Shadow')}
                        
                        ${this.renderTextInput('iconSize', 'Icon Size')}
                    </div>
                </div>

                <div class="tab">
                    <div class="tab-label">Actions</div>
                    <div class="tab-content">
                        ${this.renderActionPicker('actionUp', 'Swipe Up')}
                        ${this.renderActionPicker('actionDown', 'Swipe Down')}
                        ${this.renderActionPicker('actionLeft', 'Swipe Left')}
                        ${this.renderActionPicker('actionRight', 'Swipe Right')}
                        ${this.renderActionPicker('actionCenter', 'Center Click')}
                        ${this.renderActionPicker('actionDouble', 'Double Click')}
                        ${this.renderActionPicker('actionTriple', 'Triple Click')}
                        ${this.renderActionPicker('actionQuadruple', 'Quadruple Click')}
                        ${this.renderActionPicker('actionHold', 'Hold Action')}
                    </div>
                </div>

                <div class="tab">
                    <div class="tab-label">Icons</div>
                    <div class="tab-content grid-2-col">
                        ${this.renderIconPicker('icoDefault', 'Default Icon')}
                        ${this.renderIconPicker('icoUp', 'Up Icon')}
                        ${this.renderIconPicker('icoDown', 'Down Icon')}
                        ${this.renderIconPicker('icoLeft', 'Left Icon')}
                        ${this.renderIconPicker('icoRight', 'Right Icon')}
                        ${this.renderIconPicker('icoCenter', 'Center Icon')}
                        ${this.renderIconPicker('icoHold', 'Hold Icon')}
                        ${this.renderIconPicker('icoDouble', 'Double Click Icon')}
                    </div>
                </div>

                <div class="tab">
                    <div class="tab-label">Advanced</div>
                    <div class="tab-content advanced-tab-content">
                        ${this.renderSelect('dragMode', 'Drag Mode', ['spring', 'grid'], 'spring')}
                        ${this.renderCheckbox('isStandalone', 'Standalone', true)} 
                        ${this.renderCheckbox('lockNonActionDirs', 'Lock Non-Action Directions', true)}
                        <div class="grid-2-col">
                            ${this.config.dragMode === 'grid' ? html`
                                ${this.renderNumberInput('gridX', 'Horizontal Grid Distance (px)', 50)}
                                ${this.renderNumberInput('gridY', 'Vertical Grid Distance (px)', 50)}
                            ` : ''}
                            ${this.renderNumberInput('maxDrag', 'Max Drag', 100)}
                            ${this.renderNumberInput('returnTime', 'Return Time', 200)}
                            ${this.renderNumberInput('springDamping', 'Spring Damping', 2)}
                            ${this.renderNumberInput('repeatTime', 'Repeat Time', 200)}
                            ${this.renderNumberInput('holdTime', 'Hold Time', 800)}
                            ${this.renderNumberInput('multiClickTime', 'Multi-click Time', 300)}
                            ${this.renderNumberInput('deadzone', 'Deadzone', 20)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // These are the building blocks for the configurator html
    private renderActionPicker(configKey: keyof DragCardConfig, label: string) {
        return html`
            <ha-selector
                .hass=${this.hass}
                .label=${label}
                .selector=${{ "ui-action": {} }}
                .configValue=${configKey}
                .value=${this.config?.[configKey]}
                @value-changed=${this._valueChanged}
            ></ha-selector>
        `;
    }
    private renderSelect(configKey: keyof DragCardConfig, label: string, options: string[], defaultValue: string) {
        return html`
            <ha-selector
                class="select-selector"
                .hass=${this.hass}
                .label=${label}
                .selector=${{ select: { options } }}
                .configValue=${configKey}
                .value=${this.config![configKey] || defaultValue}
                @value-changed=${this._valueChanged}
            ></ha-selector>
        `;
    }
    private renderIconPicker(configKey: keyof DragCardConfig, label: string) {
        return html`
            <ha-icon-picker
                .hass=${this.hass}
                .label=${label}
                .configValue=${configKey}
                .value=${this.config![configKey] || ""}
                @value-changed=${this._valueChanged}
            ></ha-icon-picker>
        `;
    }
    private renderNumberInput(configKey: keyof DragCardConfig, label: string, defaultValue: number = 0) {
        return html`
            <ha-selector
                .hass=${this.hass}
                .label=${label}
                .selector=${{ text: { type: "number" } }}
                .configValue=${configKey}
                .value=${this.config![configKey] || defaultValue}
                @value-changed=${this._valueChanged}
            ></ha-selector>
        `;
    }
    private renderTextInput(configKey: keyof DragCardConfig, label: string, defaultValue: string = "") {
        return html`
            <ha-selector
                .hass=${this.hass}
                .label=${label}
                .selector=${{ text: {} }}
                .configValue=${configKey}
                .value=${this.config![configKey] || defaultValue}
                @value-changed=${this._valueChanged}
            ></ha-selector>
        `;
    }
    private renderCheckbox(configKey: keyof DragCardConfig, label: string, defaultValue: boolean = false) {
        return html`
            <ha-selector
                class="checkbox-selector"
                .hass=${this.hass}
                .label=${label}
                .selector=${{ boolean: {} }}
                .configValue=${configKey}
                .value=${this.config![configKey] !== undefined ? this.config![configKey] : defaultValue}
                @value-changed=${this._valueChanged}
            ></ha-selector>
        `;
    }
}












declare global {
    interface HTMLElementTagNameMap {
        'drag-card-editor': DragCardEditor;
    }
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
    type: 'drag-card',
    name: 'Drag Card',
    description: 'A draggable button with directional actions',
    preview: true,
    documentationURL: 'https://github.com/BlackCube4/Drag-Card'
});