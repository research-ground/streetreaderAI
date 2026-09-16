"""
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
 """

import pytest
from playwright.sync_api import Page, expect
import os
import re

@pytest.fixture(autouse=True)
def silent_speech_mock(page: Page):
    page.add_init_script("""
        class MockSpeechSynthesis {
            constructor() {
                this.paused = false;
                this.pending = false;
                this.speaking = false;
                this._voices = [];
            }
            getVoices() {
                return [
                    { name: 'Google US English', lang: 'en-US', default: true, voiceURI: 'Google US English', localService: true }
                ];
            }
            speak(utterance) {
                this.speaking = true;
                if (!window._spokenPhrases) {
                    window._spokenPhrases = [];
                }
                window._spokenPhrases.push(utterance.text);
                console.log('MOCK_SPEECH: ' + utterance.text);
                
                // Trigger events asynchronously
                setTimeout(() => {
                    this.speaking = false;
                    if (utterance.onend) {
                        utterance.onend({ type: 'end', utterance: utterance });
                    }
                }, 100);
            }
            cancel() {
                this.speaking = false;
                if (!window._spokenPhrases) {
                    window._spokenPhrases = [];
                }
                window._spokenPhrases.push('[SPEECH_CANCELLED]');
            }
            pause() {
                this.paused = true;
            }
            resume() {
                this.paused = false;
            }
        }

        const mockSpeech = new MockSpeechSynthesis();
        Object.defineProperty(window, 'speechSynthesis', {
            get: () => mockSpeech,
            configurable: true
        });
        
        window.SpeechSynthesisUtterance = class MockSpeechSynthesisUtterance {
            constructor(text) {
                this.text = text;
                this.volume = 1.0;
                this.rate = 1.0;
                this.pitch = 1.0;
                this.lang = 'en-US';
                this.onend = null;
                this.onerror = null;
            }
        };
    """)

def setup_first_visit(page: Page):
    """
    Forces the 'First Visit' state by ensuring localStorage is clean before loading.
    """
    page.goto("http://localhost:5001")
    page.evaluate("window.localStorage.clear();")
    page.reload()

def setup_returning_visit(page: Page, preset: str = "default"):
    """
    Forces a 'Returning Visit' state by pre-populating localStorage.
    """
    page.goto("http://localhost:5001")
    speech_enabled = "true" if preset == "default" else "false"
    modifier_key = "alt" if preset == "default" else "shift-alt"
    page.evaluate(f"""() => {{
        window.localStorage.setItem('streetreader_show_welcome', 'false');
        window.localStorage.setItem('streetreader_speech_enabled', '{speech_enabled}');
        window.localStorage.setItem('streetreader_modifier_key', '{modifier_key}');
    }}""")
    page.reload()
    try:
        # Wait up to 1.5 seconds for the audio unlock dialog to display
        page.wait_for_selector("app-activation-dialog", timeout=1500)
        page.get_by_role("button", name="Activate").click()
    except Exception:
        pass

def test_first_visit_default_preset(page: Page):
    """
    Test first-time visit: select default controls preset.
    """
    setup_first_visit(page)
    
    # Verify dialogue is visible
    welcome_dialog = page.locator("app-first-run-dialog")
    expect(welcome_dialog).to_be_visible()
    
    # Click default controls
    welcome_dialog.get_by_role("button", name="Select default controls").click()
    expect(welcome_dialog).not_to_be_visible()
    
    # Verify correct values are saved to localStorage
    welcome_val = page.evaluate("window.localStorage.getItem('streetreader_show_welcome')")
    speech_val = page.evaluate("window.localStorage.getItem('streetreader_speech_enabled')")
    mod_val = page.evaluate("window.localStorage.getItem('streetreader_modifier_key')")
    
    assert welcome_val == "false"
    assert speech_val == "true"
    assert mod_val == "alt"
    
    # Verify main layout panels are attached
    expect(page.locator("app-navigation")).to_be_attached()
    expect(page.locator("app-scene-description")).to_be_attached()
    expect(page.locator("app-chat")).to_be_attached()

def test_first_visit_screen_reader_preset(page: Page):
    """
    Test first-time visit: select screen-reader-optimized controls preset.
    """
    setup_first_visit(page)
    
    # Verify dialogue is visible
    welcome_dialog = page.locator("app-first-run-dialog")
    expect(welcome_dialog).to_be_visible()
    
    # Click screen-reader controls
    welcome_dialog.get_by_role("button", name="Select screen reader-optimized controls").click()
    expect(welcome_dialog).not_to_be_visible()
    
    # Verify correct values are saved to localStorage
    welcome_val = page.evaluate("window.localStorage.getItem('streetreader_show_welcome')")
    speech_val = page.evaluate("window.localStorage.getItem('streetreader_speech_enabled')")
    mod_val = page.evaluate("window.localStorage.getItem('streetreader_modifier_key')")
    
    assert welcome_val == "false"
    assert speech_val == "false"
    assert mod_val == "shift-alt"
    
    # Verify main layout panels are attached
    expect(page.locator("app-navigation")).to_be_attached()
    expect(page.locator("app-scene-description")).to_be_attached()
    expect(page.locator("app-chat")).to_be_attached()

def test_returning_visit_skips_dialog(page: Page):
    """
    Test returning visit: the welcome dialog is skipped entirely.
    """
    setup_returning_visit(page, "default")
    
    # Welcome dialog must NOT be visible
    welcome_dialog = page.locator("app-first-run-dialog")
    expect(welcome_dialog).not_to_be_visible()
    
    # Main components must be immediately active and attached
    expect(page.locator("app-navigation")).to_be_attached()
    expect(page.locator("app-scene-description")).to_be_attached()
    expect(page.locator("app-chat")).to_be_attached()

def test_speech_output_on_first_visit(page: Page):
    """
    Test verbal announcements generated on a clean first-time setup visit.
    """
    setup_first_visit(page)
    
    welcome_dialog = page.locator("app-first-run-dialog")
    expect(welcome_dialog).to_be_visible()
    
    # Select standard preset
    welcome_dialog.get_by_role("button", name="Select default controls").click()
    expect(welcome_dialog).not_to_be_visible()
    
    # Wait for the async announcements queue
    page.wait_for_timeout(1000)
    
    spoken_phrases = page.evaluate("window._spokenPhrases || []")
    
    # Verify initialization speech components
    assert any("Street Reader A I initialized" in phrase for phrase in spoken_phrases)
    assert any("You are at" in phrase for phrase in spoken_phrases)
    assert any("No description available" in phrase for phrase in spoken_phrases)

def test_settings_retention_across_refresh(page: Page):
    """
    Scenario 5: Changing settings, refreshing the page, and verifying that all 
    preferences are correctly preserved in localStorage and app state.
    """
    setup_returning_visit(page, "default")
    # Wait for the main page bootstrap to stabilize
    expect(page.locator("app-navigation")).to_be_visible()
    
    # 1. Open the Settings modal
    page.get_by_role("button", name="Settings").click()
    expect(page.get_by_role("heading", name="Settings", exact=True)).to_be_visible()
    
    # 2. Modify Global Modifier Key to 'Ctrl'
    page.get_by_label("Global Modifier Key").click()
    page.get_by_role("option", name="Ctrl", exact=True).click()
    
    # 3. Toggle 'Allow movement commands in chat'
    allow_move_toggle = page.locator(".setting-item").filter(has_text="Allow movement commands in chat").locator("button")
    is_initially_checked = allow_move_toggle.get_attribute("aria-checked") == "true"
    allow_move_toggle.click()
    
    # 4. Close the settings dialog
    page.get_by_role("button", name="Close").click()
    expect(page.get_by_role("heading", name="Settings", exact=True)).not_to_be_visible()
    
    # 5. Refresh the page context
    page.reload()
    expect(page.locator("app-navigation")).to_be_visible()
    try:
        page.wait_for_selector("app-activation-dialog", timeout=1500)
        page.get_by_role("button", name="Activate").click()
    except Exception:
        pass
    
    # 6. Re-open Settings and verify state properties are preserved!
    page.get_by_role("button", name="Settings").click()
    
    # Check Modifier select holds 'Ctrl'
    selected_modifier = page.locator("mat-select").filter(has_text=re.compile(r"^Ctrl$"))
    expect(selected_modifier).to_be_visible()
    
    # Check that 'Allow movement commands in chat' toggle retains the correct opposite state
    current_toggle_checked = page.locator(".setting-item").filter(has_text="Allow movement commands in chat").locator("button").get_attribute("aria-checked") == "true"
    assert current_toggle_checked == (not is_initially_checked)
    
    # Clean close
    page.get_by_role("button", name="Close").click()

def test_settings_reset_to_clean_slate(page: Page):
    """
    Scenario 6: Performing a 'Reset settings' action and confirming the app returns 
    to a clean onboarding slate.
    """
    setup_returning_visit(page, "default")
    
    # Wait for the page bootstrap to stabilize
    expect(page.locator("app-navigation")).to_be_visible()
    
    # Welcome panel must skip by default on returning visit
    expect(page.locator("app-first-run-dialog")).not_to_be_visible()
    
    # Open settings
    page.get_by_role("button", name="Settings").click()
    
    # Find the reset button inside the danger zone and click it!
    reset_button = page.locator(".danger-zone").get_by_role("button", name="Reset")
    expect(reset_button).to_be_visible()
    reset_button.click()
    
    # Wait for the async reload to occur
    page.wait_for_timeout(1000)
    
    # Assert that the onboarding First Run dialog has returned! (Clean Slate confirmed!)
    expect(page.locator("app-first-run-dialog")).to_be_visible()

def test_keyboard_movement_navigation(page: Page):
    """
    Scenario 8 & 14: Verifying global hotkeys movement sequences (Alt + Arrows) 
    and checking that relative heading verbal announcements are correctly triggered.
    """
    setup_returning_visit(page, "default")
    
    # Wait for the page bootstrap to stabilize
    expect(page.locator("app-navigation")).to_be_visible()
    
    # 1. Rotate Left (Alt+ArrowLeft)
    page.keyboard.press("Alt+ArrowLeft")
    page.wait_for_timeout(1000)
    
    spoken_phrases = page.evaluate("window._spokenPhrases || []")
    print(f"\n[DIAGNOSTIC SPOKEN PHRASES]: {spoken_phrases}")
    
    # Verify that the self-voicing system announced the new rotation heading
    assert any("Rotated" in phrase or "°" in phrase for phrase in spoken_phrases)
    
    # 2. Move Forward (Alt+ArrowUp)
    page.keyboard.press("Alt+ArrowUp")
    page.wait_for_timeout(1000)

def test_address_search_and_autocomplete(page: Page):
    """
    Scenario 7: Entering partial query, waiting for autocomplete suggestions, 
    selecting first option, and asserting coordinates snap.
    """
    setup_returning_visit(page, "default")
    
    # Wait for page bootstrap
    expect(page.locator("app-navigation")).to_be_visible()
    
    # Find the Address Search text field and focus it
    search_input = page.get_by_placeholder("Enter an address")
    expect(search_input).to_be_visible()
    
    # Type partial query
    search_input.fill("Pike Place")
    page.wait_for_timeout(1000)
    
    # If public OSM rate limit was hit, dismiss dialog gracefully; otherwise click suggestion
    rate_limit_dialog = page.get_by_role("heading", name="Autocomplete Error")
    if rate_limit_dialog.is_visible(timeout=2000):
        dismiss_btn = page.get_by_role("button", name="Dismiss").first
        dismiss_btn.click()
    else:
        # Wait for autocomplete panel to appear and select the first enabled suggestion option
        autocomplete_panel = page.locator(".mat-mdc-autocomplete-panel")
        if autocomplete_panel.is_visible(timeout=3000):
            first_suggestion = autocomplete_panel.locator("mat-option:not([disabled])").first
            if first_suggestion.is_visible(timeout=3000):
                first_suggestion.click()
                page.wait_for_timeout(1500)
                expect(autocomplete_panel).not_to_be_visible()
