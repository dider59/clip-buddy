import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClipBuddyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Clip Buddy'),
            icon_name: 'edit-paste-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: _('General'),
            description: _('Minimalist clipboard settings'),
        });
        page.add(group);

        const historyRow = new Adw.SpinRow({
            title: _('Clipboard history'),
            subtitle: _('Maximum number of items to keep (5-100)'),
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 100,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('max-history'),
            }),
        });
        historyRow.connect('notify::value', () => {
            settings.set_int('max-history', historyRow.get_value());
        });
        group.add(historyRow);

        const storageRow = new Adw.SpinRow({
            title: _('Max storage'),
            subtitle: _('Maximum size per copy in MB (1-50 MB). Larger copies are ignored. Default 1 MB.'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 50,
                step_increment: 1,
                page_increment: 1,
                value: settings.get_int('max-storage-mb'),
            }),
        });
        storageRow.connect('notify::value', () => {
            settings.set_int('max-storage-mb', storageRow.get_value());
        });
        group.add(storageRow);

        const infoGroup = new Adw.PreferencesGroup({
            title: _('About'),
        });
        const infoRow = new Adw.ActionRow({
            title: _('Clip Buddy'),
            subtitle: _('Secure, memory-only. Uses native Meta.Selection. Settings: history + max storage.'),
        });
        infoGroup.add(infoRow);
        page.add(infoGroup);

        window.add(page);
    }
}
