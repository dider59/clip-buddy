import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

const ClipBuddyIndicator = GObject.registerClass(
class ClipBuddyIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Clip Buddy', false);
        this._extension = extension;
        
        try {
            this._settings = extension.getSettings();
            this._maxHistory = this._settings.get_int('max-history');
            this._maxStorageMB = this._settings.get_int('max-storage-mb');
        } catch (e) {
            log(`[Clip Buddy] gschemas.compiled missing: ${e.message}`);
            this._settings = null;
            this._maxHistory = 20;
            this._maxStorageMB = 1;
        }

        this._history = [];
        this._filtered = null;
        this._isSelfCopy = false;
        this._lastCopiedText = null;
        this._debounceId = 0;

        const icon = new St.Icon({
            icon_name: 'edit-paste-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        // Main container - DO NOT override menu.box background, keep system default
        this._mainBox = new St.BoxLayout({
            vertical: true,
            style_class: 'clip-buddy-container',
            x_expand: true,
        });
        this._mainBox.set_width(360);

        // Scroll area
        this._scrollView = new St.ScrollView({
            style_class: 'clip-buddy-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });
        this._itemsBox = new St.BoxLayout({
            vertical: true,
            style_class: 'clip-buddy-list',
            x_expand: true,
        });
        this._scrollView.add_child(this._itemsBox);

        // Empty state
        this._emptyState = new St.BoxLayout({
            vertical: true,
            style_class: 'clip-buddy-empty',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        const emptyIcon = new St.Icon({
            icon_name: 'edit-paste-symbolic',
            icon_size: 64,
            style_class: 'clip-buddy-empty-icon',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const emptyLabel = new St.Label({
            text: 'Clipboard is empty',
            style_class: 'clip-buddy-empty-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._emptyState.add_child(emptyIcon);
        this._emptyState.add_child(emptyLabel);

        // --- Confirmation bar (inline alert) ---
        this._confirmBar = new St.BoxLayout({
            vertical: false,
            style_class: 'clip-buddy-confirm-bar',
            x_expand: true,
            visible: false,
        });
        const confirmLabel = new St.Label({
            text: 'Clear all?',
            style_class: 'clip-buddy-confirm-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const confirmYes = new St.Button({
            style_class: 'clip-buddy-confirm-yes',
            label: 'Clear',
            x_align: Clutter.ActorAlign.END,
        });
        const confirmNo = new St.Button({
            style_class: 'clip-buddy-confirm-no',
            label: 'Cancel',
            x_align: Clutter.ActorAlign.END,
        });
        confirmYes.connect('clicked', () => this._doClearAll());
        confirmNo.connect('clicked', () => this._hideConfirmBar());
        this._confirmBar.add_child(confirmLabel);
        this._confirmBar.add_child(confirmNo);
        this._confirmBar.add_child(confirmYes);

        // Bottom row: search + clear ICON button
        this._bottomRow = new St.BoxLayout({
            vertical: false,
            style_class: 'clip-buddy-bottom',
            x_expand: true,
        });
        this._searchEntry = new St.Entry({
            hint_text: 'Search clipboard…',
            style_class: 'clip-buddy-search',
            x_expand: true,
            can_focus: true,
        });
        this._searchEntry.clutter_text.connect('text-changed', () => {
            this._onSearchChanged();
        });

        // Clear icon button - always visible, system icon
        this._clearButton = new St.Button({
            style_class: 'clip-buddy-clear',
            can_focus: false,
            accessible_name: 'Clear all clipboard history',
            child: new St.Icon({
                icon_name: 'edit-clear-symbolic',
                icon_size: 16,
            }),
        });
        this._clearButton.connect('clicked', () => this._onClearClicked());

        this._bottomRow.add_child(this._searchEntry);
        this._bottomRow.add_child(this._clearButton);

        this._mainBox.add_child(this._scrollView);
        this._mainBox.add_child(this._emptyState);
        this._mainBox.add_child(this._confirmBar);
        this._mainBox.add_child(this._bottomRow);

        // IMPORTANT: Keep system default background. Don't replace style_class
        this.menu.box.add_child(this._mainBox);

        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed::max-history', () => {
                this._maxHistory = this._settings.get_int('max-history');
                this._trimHistory();
                this._updateUI();
            });
            this._storageChangedId = this._settings.connect('changed::max-storage-mb', () => {
                this._maxStorageMB = this._settings.get_int('max-storage-mb');
            });
        }

        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();

        this._ownerChangedId = this._selection.connect('owner-changed', (selection, selectionType) => {
            try {
                if (Meta.SelectionType && selectionType !== Meta.SelectionType.SELECTION_CLIPBOARD) {
                    return;
                }
            } catch (e) {}
            if (this._debounceId) GLib.source_remove(this._debounceId);
            this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._debounceId = 0;
                this._onClipboardOwnerChanged();
                return GLib.SOURCE_REMOVE;
            });
        });

        this._onClipboardOwnerChanged();
        this._updateUI();

        this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._searchEntry.grab_key_focus();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._hideConfirmBar();
                this._searchEntry.set_text('');
            }
        });
    }

    _onClipboardOwnerChanged() {
        this._clipboard.get_text(CLIPBOARD_TYPE, (clipboard, text) => {
            if (!text) return;
            const trimmed = text.trim();
            if (!trimmed) return;
            if (text.length > this._maxStorageMB * 1024 * 1024) return;
            if (this._isSelfCopy && text === this._lastCopiedText) {
                this._isSelfCopy = false;
                return;
            }
            this._isSelfCopy = false;
            if (this._history.length > 0 && this._history[0] === text) return;
            this._addToHistory(text);
        });
    }

    _addToHistory(text) {
        const idx = this._history.indexOf(text);
        if (idx !== -1) this._history.splice(idx, 1);
        this._history.unshift(text);
        this._trimHistory();
        this._updateUI();
    }

    _trimHistory() {
        if (this._history.length > this._maxHistory) {
            this._history = this._history.slice(0, this._maxHistory);
        }
    }

    _onItemClicked(text) {
        this._addToHistory(text);
        this._lastCopiedText = text;
        this._isSelfCopy = true;
        this._clipboard.set_text(CLIPBOARD_TYPE, text);
        this._updateUI();
    }

    _onSearchChanged() {
        this._searchText = this._searchEntry.get_text().toLowerCase().trim();
        this._filtered = this._searchText ? this._history.filter(t => t.toLowerCase().includes(this._searchText)) : null;
        this._updateUI();
    }

    _updateUI() {
        const list = this._filtered !== null ? this._filtered : this._history;
        this._itemsBox.destroy_all_children();

        if (this._history.length === 0) {
            this._scrollView.hide();
            this._emptyState.show();
            this._confirmBar.hide();
            this._bottomRow.show();
            const label = this._emptyState.get_children()[1];
            if (label) label.set_text('Clipboard is empty');
            this._clearButton.set_reactive(false);
            this._clearButton.add_style_class_name('clip-buddy-clear-disabled');
            return;
        }

        this._clearButton.set_reactive(true);
        this._clearButton.remove_style_class_name('clip-buddy-clear-disabled');

        if (list.length === 0) {
            this._scrollView.hide();
            this._emptyState.show();
            const label = this._emptyState.get_children()[1];
            if (label) label.set_text('No matches found');
            return;
        }

        this._emptyState.hide();
        this._scrollView.show();

        for (const fullText of list) {
            // Performance: truncate first, then collapse whitespace - avoids regex on huge strings
            let display = fullText.substring(0, 500).replace(/\s+/g, ' ').trim();
            if (display.length > 300) display = display.substring(0, 300);
            const button = new St.Button({
                style_class: 'clip-buddy-item',
                x_expand: true,
                can_focus: false,
            });
            const label = new St.Label({
                text: display,
                style_class: 'clip-buddy-item-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.set_single_line_mode(true);
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            button.set_child(label);
            button.connect('clicked', () => this._onItemClicked(fullText));
            this._itemsBox.add_child(button);
        }

        const h = Math.min(380, Math.max(72, Math.min(list.length, 8) * 36));
        this._scrollView.set_height(h);
    }

    _onClearClicked() {
        if (this._history.length === 0) return;
        // Show inline confirmation bar instead of only notification
        this._showConfirmBar();
    }

    _showConfirmBar() {
        this._confirmBar.show();
        this._confirmBar.get_children()[0].set_text(`Clear ${this._history.length} items?`);
    }

    _hideConfirmBar() {
        this._confirmBar.hide();
    }

    _doClearAll() {
        this._history = [];
        this._filtered = null;
        this._searchEntry.set_text('');
        this._hideConfirmBar();
        this._updateUI();
        // Feedback notification after confirmed clear
        Main.notify('Clip Buddy', 'Clipboard history cleared');
    }

    destroy() {
        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
        }
        if (this._storageChangedId && this._settings) {
            this._settings.disconnect(this._storageChangedId);
        }
        if (this._ownerChangedId && this._selection) {
            this._selection.disconnect(this._ownerChangedId);
        }
        if (this._debounceId) GLib.source_remove(this._debounceId);
        super.destroy();
    }
});

export default class ClipBuddyExtension extends Extension {
    enable() {
        this._indicator = new ClipBuddyIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }
    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
