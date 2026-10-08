import { expect, type Page } from "@playwright/test";

const TEST_PASSPHRASE = "LifeOS E2E release gate passphrase";

/** Opens or initializes the persistent local-content key in a fresh page. */
export async function unlockPersistentLocalContent(page: Page): Promise<void> {
  const lock = page.getByTestId("local-content-lock-screen");
  await expect(lock).toBeVisible({ timeout: 20_000 });

  const newPassphrase = page.getByLabel("Uusi tunnuslause");
  if (await newPassphrase.isVisible()) {
    await newPassphrase.fill(TEST_PASSPHRASE);
    await page.getByLabel("Vahvista tunnuslause").fill(TEST_PASSPHRASE);
    await page.getByRole("button", { name: "Luo paikallisen sisällön salaus" }).click();
    await expect(page.getByLabel("Palautusavain")).toBeVisible();
    const recoveryDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Lataa palautustiedosto" }).click();
    await recoveryDownload;
    await page
      .getByRole("checkbox", { name: "Olen tallentanut palautustiedoston ja palautusavaimen." })
      .check();
    await page.getByRole("button", { name: "Salaa paikalliset tiedot ja jatka" }).click();
  } else {
    const envelopePicker = page.getByLabel("Avaimen avaus");
    if (await envelopePicker.isVisible()) {
      const passphraseOption = envelopePicker.locator("option").filter({ hasText: "passphrase" });
      const envelopeId = await passphraseOption.getAttribute("value");
      if (envelopeId !== null) await envelopePicker.selectOption(envelopeId);
    }
    await page.getByLabel("Tunnuslause").fill(TEST_PASSPHRASE);
    await page.getByRole("button", { name: "Avaa paikalliset tiedot" }).click();
  }

  await expect(lock).toBeHidden({ timeout: 20_000 });
}
