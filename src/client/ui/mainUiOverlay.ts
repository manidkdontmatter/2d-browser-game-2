// Owns the fullscreen in-game menu surface opened by the central UI state controller.
// The overlay provides section navigation, focus restoration, and durable content
// regions for character, inventory, ability authoring, and settings workflows. The
// character section displays server-authoritative allocated and derived stats with
// point allocation controls, while ability panels are real client-side authoring
// tools backed by shared validation rules.
import {
  abilityTiers,
  abilityTypes,
  getAbilityAttributeDefinitions,
  getAbilityStatDefinitions,
  summarizeAuthoredAbility,
  type AbilityAttributeDefinition,
  type AbilityAttributePolarity,
  type AbilityTier,
  type AbilityType,
  type AuthoredAbilityDefinition,
} from '../../shared/abilities/abilityAuthoring.js';
import { RequestEndpoint } from '../../shared/net/requestEndpoints.js';
import type { CharacterStatsResponse } from '../../shared/net/statRequests.js';
import {
  characterStatAllocationDefinitions,
  characterDerivedEffectDefinitions,
  MAX_ALLOCATION_POINTS,
} from '../../shared/stats/characterStats.js';
import type { ClientConnection } from '../net/clientConnection.js';
import { AbilityAuthoringStore } from './abilityAuthoringStore.js';
import { ExclusiveUiScreen } from './uiStateController.js';

type MainUiSectionKey = 'character' | 'inventory' | 'abilities' | 'ability-creator' | 'settings';

interface MainUiSectionDefinition {
  key: MainUiSectionKey;
  label: string;
}

interface AbilityResultChip {
  readonly label: string;
  readonly description: string;
  readonly polarity?: AbilityAttributePolarity;
}

const MAIN_UI_SECTIONS: readonly MainUiSectionDefinition[] = [
  { key: 'character', label: 'Character' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'abilities', label: 'Abilities' },
  { key: 'ability-creator', label: 'Ability Creator' },
  { key: 'settings', label: 'Settings' },
];

const abilityTypeLabels: Readonly<Record<AbilityType, string>> = {
  melee: 'Melee',
  projectile: 'Projectile',
  beam: 'Beam',
  area_of_effect: 'Area of Effect',
  buff: 'Buff',
  movement: 'Movement',
};

export class MainUiOverlay {
  readonly screen = ExclusiveUiScreen.MainMenu;
  private readonly element: HTMLDivElement;
  private readonly abilityStore = new AbilityAuthoringStore();
  private readonly sectionButtons = new Map<MainUiSectionKey, HTMLButtonElement>();
  private readonly sectionTitle = document.createElement('h1');
  private readonly content = document.createElement('section');
  private connection: ClientConnection | null = null;
  private characterStats: CharacterStatsResponse | null = null;
  private statsRequestInFlight = false;
  private activeSectionKey: MainUiSectionKey = 'character';
  private open = false;
  private previousFocus: HTMLElement | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'main-ui-overlay';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Game menu');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.hidden = true;
    this.element.style.display = 'none';

    const backdrop = document.createElement('div');
    backdrop.className = 'main-ui-backdrop';

    const shell = document.createElement('div');
    shell.className = 'main-ui-shell';
    shell.append(this.createNavigation(), this.createPanel());

    this.element.append(backdrop, shell);
    document.body.appendChild(this.element);

    this.activateSection(this.activeSectionKey);
  }

  setConnection(connection: ClientConnection): void {
    this.connection = connection;
  }

  setOpen(open: boolean): void {
    if (this.open === open) {
      return;
    }

    if (open) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.requestCharacterStats();
    }

    this.open = open;
    this.element.hidden = !open;
    this.element.style.display = open ? 'flex' : 'none';
    this.element.setAttribute('aria-hidden', open ? 'false' : 'true');

    if (open) {
      queueMicrotask(() => {
        this.sectionButtons.get(this.activeSectionKey)?.focus();
      });
      return;
    }

    this.previousFocus?.focus();
    this.previousFocus = null;
  }

  private createNavigation(): HTMLElement {
    const nav = document.createElement('nav');
    nav.className = 'main-ui-nav';
    nav.setAttribute('aria-label', 'Game menu sections');

    const heading = document.createElement('div');
    heading.className = 'main-ui-nav-heading';
    heading.textContent = 'Menu';

    const sectionList = document.createElement('div');
    sectionList.className = 'main-ui-section-list';

    for (const section of MAIN_UI_SECTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'main-ui-section-button';
      button.textContent = section.label;
      button.addEventListener('click', () => this.activateSection(section.key));

      this.sectionButtons.set(section.key, button);
      sectionList.appendChild(button);
    }

    const shortcut = document.createElement('div');
    shortcut.className = 'main-ui-shortcut';
    shortcut.append(this.createShortcutKey(), document.createTextNode('Close'));

    nav.append(heading, sectionList, shortcut);
    return nav;
  }

  private createShortcutKey(): HTMLElement {
    const key = document.createElement('span');
    key.className = 'main-ui-shortcut-key';
    key.textContent = '~';
    return key;
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('main');
    panel.className = 'main-ui-panel';

    const header = document.createElement('header');
    header.className = 'main-ui-panel-header';

    this.sectionTitle.className = 'main-ui-panel-title';
    header.appendChild(this.sectionTitle);

    this.content.className = 'main-ui-content';
    this.content.setAttribute('aria-live', 'polite');

    panel.append(header, this.content);
    return panel;
  }

  private activateSection(key: MainUiSectionKey): void {
    const section = MAIN_UI_SECTIONS.find((entry) => entry.key === key);
    if (!section) {
      return;
    }

    this.activeSectionKey = key;
    this.sectionTitle.textContent = section.label;

    for (const [sectionKey, button] of this.sectionButtons) {
      const active = sectionKey === key;
      button.dataset.active = active ? 'true' : 'false';
      if (active) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }

    this.renderActiveSection();
  }

  private renderActiveSection(): void {
    if (this.activeSectionKey === 'character') {
      this.content.replaceChildren(this.createCharacterPanel());
      return;
    }
    if (this.activeSectionKey === 'abilities') {
      this.content.replaceChildren(this.createAbilitiesPanel());
      return;
    }
    if (this.activeSectionKey === 'ability-creator') {
      this.content.replaceChildren(this.createAbilityCreatorPanel());
      return;
    }
    this.content.replaceChildren(this.createPlaceholder());
  }

  private requestCharacterStats(): void {
    if (!this.connection || this.statsRequestInFlight) {
      return;
    }

    this.statsRequestInFlight = true;
    this.connection.requestCharacterStats((response) => {
      this.statsRequestInFlight = false;
      if (response) {
        this.characterStats = response;
        if (this.activeSectionKey === 'character') {
          this.renderActiveSection();
        }
      }
    });
  }

  private sendAllocateStat(statId: string): void {
    if (!this.connection || this.statsRequestInFlight) {
      return;
    }

    this.statsRequestInFlight = true;
    this.connection.sendAllocateStat(statId, (response) => {
      this.statsRequestInFlight = false;
      if (response) {
        this.characterStats = response;
        if (this.activeSectionKey === 'character') {
          this.renderActiveSection();
        }
      }
    });
  }

  private sendRemoveStat(statId: string): void {
    if (!this.connection || this.statsRequestInFlight) {
      return;
    }

    this.statsRequestInFlight = true;
    this.connection.sendRemoveStat(statId, (response) => {
      this.statsRequestInFlight = false;
      if (response) {
        this.characterStats = response;
        if (this.activeSectionKey === 'character') {
          this.renderActiveSection();
        }
      }
    });
  }

  private sendResetStats(): void {
    if (!this.connection || this.statsRequestInFlight) {
      return;
    }

    this.statsRequestInFlight = true;
    this.connection.sendResetStats((response) => {
      this.statsRequestInFlight = false;
      if (response) {
        this.characterStats = response;
        if (this.activeSectionKey === 'character') {
          this.renderActiveSection();
        }
      }
    });
  }

  private createCharacterPanel(): HTMLElement {
    if (!this.characterStats) {
      const placeholder = this.createPlaceholder();
      if (this.statsRequestInFlight) {
        placeholder.textContent = 'Loading character stats...';
      } else {
        placeholder.textContent = 'Character stats unavailable';
      }
      return placeholder;
    }

    const stats = this.characterStats;

    const panel = document.createElement('div');
    panel.className = 'character-panel';

    const panes = document.createElement('div');
    panes.className = 'ability-creator-panes';
    panes.append(
      this.createAllocationsPane(stats),
      this.createDerivedPane(stats),
    );
    panel.appendChild(panes);
    return panel;
  }

  private createAllocationsPane(stats: CharacterStatsResponse): HTMLElement {
    const pane = this.createCreatorPane('Allocations');

    const meter = document.createElement('div');
    meter.className = 'ability-pane-meter';
    meter.textContent = `${stats.remainingPoints} of ${MAX_ALLOCATION_POINTS} points remaining`;
    pane.appendChild(meter);

    const list = document.createElement('div');
    list.className = 'ability-stat-list';

    for (const stat of characterStatAllocationDefinitions) {
      const allocated = stats.allocations[stat.id] ?? 0;

      const row = document.createElement('div');
      row.className = 'ability-stat-row';

      const label = document.createElement('div');
      label.className = 'ability-stat-label';
      label.textContent = stat.label;
      label.title = stat.description;

      const controls = document.createElement('div');
      controls.className = 'ability-stepper';

      const minus = this.createIconButton('−', `Remove point from ${stat.label}`);
      minus.disabled = allocated <= 0 || this.statsRequestInFlight;
      minus.addEventListener('click', () => this.sendRemoveStat(stat.id));

      const value = document.createElement('span');
      value.className = 'ability-stepper-value';
      value.textContent = String(allocated);

      const plus = this.createIconButton('+', `Add point to ${stat.label}`);
      plus.disabled = stats.remainingPoints <= 0 || this.statsRequestInFlight;
      plus.addEventListener('click', () => this.sendAllocateStat(stat.id));

      controls.append(value, minus, plus);
      row.append(label, controls);
      list.appendChild(row);
    }
    pane.appendChild(list);

    const totalAllocated = MAX_ALLOCATION_POINTS - stats.remainingPoints;
    const respec = this.createActionButton('Respec All');
    respec.disabled = totalAllocated <= 0 || this.statsRequestInFlight;
    respec.addEventListener('click', () => this.sendResetStats());
    pane.appendChild(respec);

    return pane;
  }

  private createDerivedPane(stats: CharacterStatsResponse): HTMLElement {
    const pane = this.createCreatorPane('Effects');

    const list = document.createElement('dl');
    list.className = 'character-derived-list';

    for (const effect of characterDerivedEffectDefinitions) {
      const value = stats.derived[effect.id] ?? effect.baseValue;
      const base = effect.baseValue;
      const delta = value - base;

      const term = document.createElement('dt');
      term.textContent = effect.label;
      term.title = `Derived from ${effect.sourceStat}`;

      const desc = document.createElement('dd');
      if (delta === 0) {
        desc.textContent = formatDerivedValue(effect.id, value);
      } else {
        desc.textContent = `${formatDerivedValue(effect.id, value)} (${delta > 0 ? '+' : ''}${formatDerivedValue(effect.id, delta)})`;
      }

      list.append(term, desc);
    }
    pane.appendChild(list);
    return pane;
  }

  private createAbilitiesPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'ability-library';

    const toolbar = document.createElement('div');
    toolbar.className = 'ability-library-toolbar';
    const count = document.createElement('div');
    count.className = 'ability-library-count';
    const abilities = this.abilityStore.getAbilities();
    count.textContent = `${abilities.length} authored ${abilities.length === 1 ? 'ability' : 'abilities'}`;
    const createButton = this.createActionButton('New Ability');
    createButton.addEventListener('click', () => {
      this.abilityStore.startNewAbility();
      this.activateSection('ability-creator');
    });
    toolbar.append(count, createButton);

    const list = document.createElement('div');
    list.className = 'ability-card-grid';

    if (abilities.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'main-ui-placeholder';
      empty.textContent = 'No authored abilities';
      list.appendChild(empty);
    } else {
      for (const ability of abilities) {
        list.appendChild(this.createAbilityCard(ability));
      }
    }

    panel.append(toolbar, list);
    return panel;
  }

  private createAbilityCard(ability: AuthoredAbilityDefinition): HTMLElement {
    const card = document.createElement('article');
    card.className = 'ability-card';

    const header = document.createElement('header');
    header.className = 'ability-card-header';
    const title = document.createElement('h2');
    title.className = 'ability-card-title';
    title.textContent = ability.name;
    const type = document.createElement('span');
    type.className = 'ability-card-type';
    type.textContent = abilityTypeLabels[ability.type];
    header.append(title, type);

    const details = document.createElement('dl');
    details.className = 'ability-card-details';
    appendDetail(details, 'Tier', String(ability.tier));
    appendDetail(details, 'Type', abilityTypeLabels[ability.type]);

    const description = document.createElement('p');
    description.className = 'ability-card-description';
    description.textContent = ability.description || 'No description';

    const actions = document.createElement('div');
    actions.className = 'ability-card-actions';
    const editButton = this.createActionButton('Alter');
    editButton.addEventListener('click', () => {
      if (this.abilityStore.editAbility(ability.id)) {
        this.activateSection('ability-creator');
      }
    });
    const deleteButton = this.createActionButton('Forget');
    deleteButton.dataset.danger = 'true';
    deleteButton.addEventListener('click', () => {
      this.abilityStore.deleteAbility(ability.id);
      this.renderActiveSection();
    });
    actions.append(editButton, deleteButton);

    const tooltip = document.createElement('div');
    tooltip.className = 'ability-card-tooltip';
    tooltip.appendChild(this.createAbilitySummary(ability, 'tooltip'));

    card.append(header, details, description, actions, tooltip);
    return card;
  }

  private createAbilityCreatorPanel(): HTMLElement {
    const draft = this.abilityStore.getDraft();
    const ability = draft.ability;
    const summary = summarizeAuthoredAbility(ability);

    const panel = document.createElement('div');
    panel.className = 'ability-creator';

    const toolbar = document.createElement('div');
    toolbar.className = 'ability-creator-toolbar';
    toolbar.append(
      this.createNameField(ability),
      this.createTypeField(ability),
      this.createTierField(ability),
      this.createCreatorActions(summary.errors.length === 0, draft.editingAbilityId !== null),
    );

    const description = this.createDescriptionField(ability);

    const panes = document.createElement('div');
    panes.className = 'ability-creator-panes';
    panes.append(
      this.createStatsPane(ability),
      this.createAttributesPane(ability),
      this.createResultsPane(ability),
    );

    panel.append(toolbar, description, panes);
    return panel;
  }

  private createNameField(ability: AuthoredAbilityDefinition): HTMLElement {
    const field = this.createFormField('Name');
    const input = document.createElement('input');
    input.className = 'ability-input';
    input.type = 'text';
    input.maxLength = 48;
    input.value = ability.name;
    input.addEventListener('input', () => {
      this.abilityStore.updateDraftName(input.value);
      this.refreshCreatorResults();
    });
    field.appendChild(input);
    return field;
  }

  private createDescriptionField(ability: AuthoredAbilityDefinition): HTMLElement {
    const field = this.createFormField('Description');
    field.classList.add('ability-description-field');
    const textarea = document.createElement('textarea');
    textarea.className = 'ability-input ability-description-input';
    textarea.maxLength = 400;
    textarea.value = ability.description;
    textarea.addEventListener('input', () => {
      this.abilityStore.updateDraftDescription(textarea.value);
      this.refreshCreatorResults();
    });
    field.appendChild(textarea);
    return field;
  }

  private createTypeField(ability: AuthoredAbilityDefinition): HTMLElement {
    const field = this.createFormField('Type');
    const select = document.createElement('select');
    select.className = 'ability-input';
    for (const type of abilityTypes) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = abilityTypeLabels[type];
      option.selected = ability.type === type;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.abilityStore.updateDraftType(select.value as AbilityType);
      this.renderActiveSection();
    });
    field.appendChild(select);
    return field;
  }

  private createTierField(ability: AuthoredAbilityDefinition): HTMLElement {
    const field = this.createFormField('Tier');
    const select = document.createElement('select');
    select.className = 'ability-input';
    for (const tier of abilityTiers) {
      const option = document.createElement('option');
      option.value = String(tier);
      option.textContent = String(tier);
      option.selected = ability.tier === tier;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.abilityStore.updateDraftTier(Number(select.value) as AbilityTier);
      this.renderActiveSection();
    });
    field.appendChild(select);
    return field;
  }

  private createCreatorActions(canSave: boolean, isEditing: boolean): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'ability-creator-actions';

    const newButton = this.createActionButton('New Ability');
    newButton.addEventListener('click', () => {
      this.abilityStore.startNewAbility();
      this.renderActiveSection();
    });

    const saveButton = this.createActionButton(isEditing ? 'Alter Ability' : 'Create Ability');
    saveButton.dataset.abilitySubmit = 'true';
    saveButton.disabled = !canSave;
    saveButton.addEventListener('click', () => {
      if (summarizeAuthoredAbility(this.abilityStore.getDraft().ability).errors.length > 0) {
        this.renderActiveSection();
        return;
      }
      this.abilityStore.saveDraft();
      this.activateSection('abilities');
    });

    actions.append(newButton, saveButton);
    return actions;
  }

  private createStatsPane(ability: AuthoredAbilityDefinition): HTMLElement {
    const pane = this.createCreatorPane('Stats');
    const summary = summarizeAuthoredAbility(ability).statPoints;

    const meter = document.createElement('div');
    meter.className = 'ability-pane-meter';
    meter.textContent = `${summary.remainingPoints} of ${summary.availablePoints} points remaining`;
    pane.appendChild(meter);

    const list = document.createElement('div');
    list.className = 'ability-stat-list';
    for (const stat of getAbilityStatDefinitions(ability.type)) {
      const row = document.createElement('div');
      row.className = 'ability-stat-row';

      const label = document.createElement('div');
      label.className = 'ability-stat-label';
      label.textContent = stat.label;
      label.title = stat.description;

      const controls = document.createElement('div');
      controls.className = 'ability-stepper';
      const minus = this.createIconButton('-', `Remove point from ${stat.label}`);
      minus.disabled = (ability.statAllocations[stat.id] ?? 0) <= 0;
      minus.addEventListener('click', () => {
        this.abilityStore.adjustDraftStat(stat.id, -1);
        this.renderActiveSection();
      });

      const value = document.createElement('span');
      value.className = 'ability-stepper-value';
      value.textContent = String(ability.statAllocations[stat.id] ?? 0);

      const plus = this.createIconButton('+', `Add point to ${stat.label}`);
      plus.disabled = summary.remainingPoints <= 0;
      plus.addEventListener('click', () => {
        this.abilityStore.adjustDraftStat(stat.id, 1);
        this.renderActiveSection();
      });

      controls.append(value, minus, plus);
      row.append(label, controls);
      list.appendChild(row);
    }
    pane.appendChild(list);
    return pane;
  }

  private createAttributesPane(ability: AuthoredAbilityDefinition): HTMLElement {
    const pane = this.createCreatorPane('Attributes');
    pane.classList.add('ability-attributes-pane');

    const budget = summarizeAuthoredAbility(ability).attributeBudget;
    const meter = document.createElement('div');
    meter.className = 'ability-pane-meter';
    meter.textContent = `${budget.remainingBudget} attribute budget remaining`;

    const sections = document.createElement('div');
    sections.className = 'ability-attribute-sections';
    sections.append(
      this.createAttributeSection('Upsides', getAbilityAttributeDefinitions(ability.type, 'upside'), ability),
      this.createAttributeSection('Downsides', getAbilityAttributeDefinitions(ability.type, 'downside'), ability),
    );
    pane.append(meter, sections);
    return pane;
  }

  private createAttributeSection(
    title: string,
    attributes: readonly AbilityAttributeDefinition[],
    ability: AuthoredAbilityDefinition,
  ): HTMLElement {
    const section = document.createElement('section');
    section.className = 'ability-attribute-section';
    const heading = document.createElement('h3');
    heading.className = 'ability-attribute-heading';
    heading.textContent = title;
    const list = document.createElement('div');
    list.className = 'ability-attribute-list';

    for (const attribute of attributes) {
      const selected = ability.attributeIds.includes(attribute.id);
      const projectedRemainingBudget = getProjectedRemainingBudget(ability, attribute, selected);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ability-attribute-button';
      button.dataset.selected = selected ? 'true' : 'false';
      button.dataset.polarity = attribute.polarity;
      button.disabled = projectedRemainingBudget < 0;
      button.title = attribute.description;
      button.addEventListener('click', () => {
        this.abilityStore.toggleDraftAttribute(attribute.id);
        this.renderActiveSection();
      });

      const label = document.createElement('span');
      label.textContent = attribute.label;
      const cost = document.createElement('span');
      cost.className = 'ability-attribute-cost';
      cost.textContent = attribute.budgetDelta > 0 ? `+${attribute.budgetDelta}` : String(attribute.budgetDelta);
      button.append(label, cost);
      list.appendChild(button);
    }

    section.append(heading, list);
    return section;
  }

  private createResultsPane(ability: AuthoredAbilityDefinition): HTMLElement {
    const pane = this.createCreatorPane('Ability Results');
    pane.classList.add('ability-results-pane');
    const summary = summarizeAuthoredAbility(ability);
    pane.appendChild(this.createAbilitySummary(ability, 'panel'));

    const validation = document.createElement('div');
    validation.className = 'ability-validation';
    validation.dataset.valid = summary.errors.length === 0 ? 'true' : 'false';
    validation.textContent = summary.errors.length === 0
      ? 'Ready'
      : summary.errors.map((error) => error.message).join(' ');
    pane.appendChild(validation);
    return pane;
  }

  private createAbilitySummary(ability: AuthoredAbilityDefinition, variant: 'panel' | 'tooltip'): HTMLElement {
    const summary = document.createElement('div');
    summary.className = `ability-summary ability-summary-${variant}`;

    const details = document.createElement('dl');
    details.className = 'ability-results-details';
    appendDetail(details, 'Name', ability.name.trim() || 'Unnamed Ability');
    appendDetail(details, 'Type', abilityTypeLabels[ability.type]);
    appendDetail(details, 'Tier', String(ability.tier));
    appendDetail(details, 'Description', ability.description || 'No description');
    summary.appendChild(details);

    summary.append(this.createStatSummaryGroup(ability));
    summary.append(this.createAttributeSummaryGroup('Upsides', getSelectedAttributeDefinitions(ability, 'upside'), 'upside'));
    summary.append(this.createAttributeSummaryGroup('Downsides', getSelectedAttributeDefinitions(ability, 'downside'), 'downside'));
    return summary;
  }

  private createStatSummaryGroup(ability: AuthoredAbilityDefinition): HTMLElement {
    const chips = getAbilityStatDefinitions(ability.type).map((stat) => {
      return {
        label: `${stat.label}: ${ability.statAllocations[stat.id] ?? 0}`,
        description: stat.description,
      };
    });
    return this.createResultsGroup('Stats', chips);
  }

  private createAttributeSummaryGroup(
    title: string,
    attributes: readonly AbilityAttributeDefinition[],
    polarity: AbilityAttributePolarity,
  ): HTMLElement {
    return this.createResultsGroup(title, attributes.map((attribute) => {
      return {
        label: attribute.label,
        description: attribute.description,
        polarity,
      };
    }));
  }

  private createResultsGroup(title: string, chips: readonly AbilityResultChip[]): HTMLElement {
    const group = document.createElement('section');
    group.className = 'ability-results-group';
    const heading = document.createElement('h3');
    heading.className = 'ability-results-heading';
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'ability-results-list';
    if (chips.length === 0) {
      body.textContent = 'None';
    } else {
      chips.forEach((definition, index) => {
        const chip = document.createElement('span');
        chip.className = 'ability-results-chip';
        if (definition.polarity) {
          chip.dataset.polarity = definition.polarity;
        }
        chip.textContent = definition.label;
        chip.title = definition.description;
        body.appendChild(chip);
        if (index < chips.length - 1) {
          body.appendChild(document.createTextNode(' '));
        }
      });
    }
    group.append(heading, body);
    return group;
  }

  private createCreatorPane(title: string): HTMLElement {
    const pane = document.createElement('section');
    pane.className = 'ability-creator-pane';
    const heading = document.createElement('h2');
    heading.className = 'ability-creator-pane-title';
    heading.textContent = title;
    pane.appendChild(heading);
    return pane;
  }

  private createFormField(labelText: string): HTMLElement {
    const label = document.createElement('label');
    label.className = 'ability-field';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'ability-field-label';
    labelSpan.textContent = labelText;
    label.appendChild(labelSpan);
    return label;
  }

  private createIconButton(text: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ability-icon-button';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.title = label;
    return button;
  }

  private createActionButton(label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ability-action-button';
    button.textContent = label;
    return button;
  }

  private createPlaceholder(): HTMLElement {
    const placeholder = document.createElement('div');
    placeholder.className = 'main-ui-placeholder';
    placeholder.textContent = 'To be implemented';
    return placeholder;
  }

  private refreshCreatorResults(): void {
    if (this.activeSectionKey !== 'ability-creator') {
      return;
    }

    const ability = this.abilityStore.getDraft().ability;
    const existingResults = this.content.querySelector('.ability-results-pane');
    existingResults?.replaceWith(this.createResultsPane(ability));

    const submit = this.content.querySelector<HTMLButtonElement>('[data-ability-submit="true"]');
    if (submit) {
      submit.disabled = summarizeAuthoredAbility(ability).errors.length > 0;
    }
  }
}

function appendDetail(list: HTMLDListElement, label: string, value: string): void {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  list.append(term, description);
}

function getProjectedRemainingBudget(
  ability: AuthoredAbilityDefinition,
  attribute: AbilityAttributeDefinition,
  selected: boolean,
): number {
  const current = summarizeAuthoredAbility(ability).attributeBudget.remainingBudget;
  return selected ? current - attribute.budgetDelta : current + attribute.budgetDelta;
}

function getSelectedAttributeDefinitions(
  ability: AuthoredAbilityDefinition,
  polarity: AbilityAttributeDefinition['polarity'],
): readonly AbilityAttributeDefinition[] {
  const selected = new Set(ability.attributeIds);
  return getAbilityAttributeDefinitions(ability.type, polarity)
    .filter((attribute) => selected.has(attribute.id));
}

function formatDerivedValue(effectId: string, value: number): string {
  if (effectId === 'attackDelayReduction' || effectId === 'cooldownReduction') {
    return `${(value * 1000).toFixed(0)}ms`;
  }
  if (effectId === 'spiritBonus') {
    return `${(value * 100).toFixed(0)}%`;
  }
  if (effectId === 'staminaRegen' || effectId === 'healthRegen') {
    return `${value.toFixed(1)}/s`;
  }
  if (effectId === 'moveSpeed') {
    return `${value.toFixed(0)}px/s`;
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1);
}
