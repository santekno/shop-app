import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  act,
  fireEvent,
  screen,
  userEvent,
} from "@testing-library/react-native";

import { renderWithProviders } from "@/test/render";
import { SEARCH_DEBOUNCE_MS, SearchBar } from "./SearchBar";

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

describe("SearchBar: searching once the user pauses", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const type = async (text: string) => {
    await fireEvent.changeText(field(), text);
  };
  const pause = (ms = SEARCH_DEBOUNCE_MS) =>
    act(() => {
      jest.advanceTimersByTime(ms);
    });

  it("waits 300 ms after the last keystroke, then searches the trimmed text", async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <SearchBar initialQuery="" onSubmit={onSubmit} />,
    );

    await type("  kaos ");
    await pause(SEARCH_DEBOUNCE_MS - 1);
    expect(onSubmit).not.toHaveBeenCalled();

    await pause(1);
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("kaos");
  });

  it("does not search a single character", async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <SearchBar initialQuery="" onSubmit={onSubmit} />,
    );

    await type("k");
    await pause(1000);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("counts an emoji as one character, so two of them are a search", async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <SearchBar initialQuery="" onSubmit={onSubmit} />,
    );

    await type("😀");
    await pause();
    expect(onSubmit).not.toHaveBeenCalled();

    await type("😀😀");
    await pause();
    expect(onSubmit).toHaveBeenCalledWith("😀😀");
  });

  it("emptying the field after a search removes it once the user pauses", async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <SearchBar initialQuery="kaos" onSubmit={onSubmit} />,
    );

    await type("");
    await pause();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("does not search what the route already shows", async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <SearchBar initialQuery="kaos" onSubmit={onSubmit} />,
    );

    await type("kaos ");
    await pause();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("the keyboard's search key searches at once, but not what the route shows", async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <SearchBar initialQuery="kaos" onSubmit={onSubmit} />,
    );

    await submit();
    expect(onSubmit).not.toHaveBeenCalled();

    await type("k");
    await submit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("k");
  });

  it("shows no clear button on an empty field", async () => {
    await renderWithProviders(
      <SearchBar initialQuery="" onSubmit={jest.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: "Hapus pencarian" }),
    ).toBeNull();
  });

  it("'Hapus pencarian' empties the field and clears the search at once", async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <SearchBar initialQuery="kaos" onSubmit={onSubmit} />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Hapus pencarian" }),
    );

    expect(field()).toHaveDisplayValue("");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("");
    expect(
      screen.queryByRole("button", { name: "Hapus pencarian" }),
    ).toBeNull();
  });

  it("starts the field again when the route's search changes from elsewhere", async () => {
    const onSubmit = jest.fn();
    const { rerender } = await renderWithProviders(
      <SearchBar initialQuery="kaos" onSubmit={onSubmit} />,
    );

    await rerender(<SearchBar initialQuery="celana" onSubmit={onSubmit} />);
    await pause();

    expect(field()).toHaveDisplayValue("celana");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves what the user is typing when the route echoes the search they just made", async () => {
    const onSubmit = jest.fn();
    const { rerender } = await renderWithProviders(
      <SearchBar initialQuery="" onSubmit={onSubmit} />,
    );
    await type("kaos");
    await pause();
    await type("kaos p");

    await rerender(<SearchBar initialQuery="kaos" onSubmit={onSubmit} />);

    expect(field()).toHaveDisplayValue("kaos p");
  });
});
