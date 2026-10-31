import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, userEvent } from "@testing-library/react-native";

import { renderWithProviders } from "@/test/render";
import { SearchBar } from "./SearchBar";

const field = () => screen.getByLabelText("Cari produk");
const submit = () => fireEvent(field(), "submitEditing");

describe("SearchBar", () => {
  it("starts with the search the screen shows", async () => {
    await renderWithProviders(
      <SearchBar initialQuery="kaos" onSubmit={() => undefined} />,
    );
    expect(field()).toHaveDisplayValue("kaos");
    expect(field()).toHaveProp("placeholder", "Cari produk");
  });

  it("hands over the trimmed text on submit, not on every keystroke", async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <SearchBar initialQuery="" onSubmit={onSubmit} />,
    );

    await userEvent.type(field(), "  kaos polos  ");
    expect(onSubmit).not.toHaveBeenCalled();

    await submit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("kaos polos");
  });

  it("hands over an empty string for a field of spaces (clears the search)", async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <SearchBar initialQuery="kaos" onSubmit={onSubmit} />,
    );

    await userEvent.clear(field());
    await userEvent.type(field(), "   ");
    await submit();

    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("limits the field to the API's 100 characters", async () => {
    await renderWithProviders(
      <SearchBar initialQuery="" onSubmit={() => undefined} />,
    );
    expect(field()).toHaveProp("maxLength", 100);
  });

  it("shows a search key and leaves the text as typed", async () => {
    await renderWithProviders(
      <SearchBar initialQuery="" onSubmit={() => undefined} />,
    );
    expect(field()).toHaveProp("enterKeyHint", "search");
    expect(field()).toHaveProp("autoCapitalize", "none");
    expect(field()).toHaveProp("autoCorrect", false);
  });

  it("colours the text cursor with the theme's primary", async () => {
    await renderWithProviders(
      <SearchBar initialQuery="" onSubmit={() => undefined} />,
    );
    expect(field()).toHaveProp("selectionColor", "#0b5cad");
  });
});
