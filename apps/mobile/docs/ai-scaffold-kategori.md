# AI scaffold: the Kategori screen (artikel 14)

This is the record of one real run, kept as the "AI box" that `docs/ai-rules.md` asks for: the exact prompt, the raw output unedited, and every change made before the code was committed, each with its reason. The committed screen is `app/(tabs)/kategori.tsx` with its feature folder `src/features/categories/`.

How it was run, on 2026-10-31:

- **The model**: Claude (a fresh Claude Code general-purpose subagent, Claude Opus 5.5) with no conversation history. It was told not to read, search, run or write any files, so it saw this repository only through what the prompt says, the way a chat assistant in a browser tab would. It reported no tool use besides returning its answer.
- **The prompt** is what a developer would paste: the stack, the file path, the endpoint with a sample response (the example from `api/openapi.yaml`), and how the catalog takes its filter. On purpose it says nothing about this repository's conventions (the shared API client, `@goshop/shared`, TanStack Query, NativeWind, the `Icon` component), so the gap between "code that works" and "code that fits" shows.
- **One run, no retries**: the output below is the first and only answer.

## Prompt

The instruction that framed the request, so the model would answer as a chat assistant:

```text
Answer the request below from this message alone, the way a chat assistant would: do not read, search, run or write any files, and do not use any tools. Reply with only the code.
```

The prompt itself, verbatim:

````text
I'm building a shop app with Expo SDK 58 (Expo Router, React Native, TypeScript). Write the screen for the "Kategori" tab, in `app/(tabs)/kategori.tsx`.

It should load the categories from our API, `GET /v1/categories`. The API's base URL is in `process.env.EXPO_PUBLIC_API_URL`. The response looks like this:

```json
{
  "data": [
    {
      "id": "0192f3a0-1c2d-7b4e-8a10-3f5e6d7c8b90",
      "slug": "pakaian",
      "name": "Pakaian",
      "parent_id": null
    },
    {
      "id": "0192f3a0-1c2d-7b4e-8a10-3f5e6d7c8b91",
      "slug": "kaos",
      "name": "Kaos",
      "parent_id": "0192f3a0-1c2d-7b4e-8a10-3f5e6d7c8b90"
    }
  ]
}
```

Show them as a tree: each top-level category with its sub-categories under it. Tapping a sub-category opens the product catalog filtered by that category. The catalog is the home tab (`app/(tabs)/index.tsx`, the route `/`) and reads the category from the query string as `?kategori=<slug>`, the same as our website.

Return only the code.
````

## Raw output

Verbatim, unedited, including the Markdown fence the model put around it:

````text
```tsx
// app/(tabs)/kategori.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

type Category = {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
};

type CategoryNode = Category & { children: CategoryNode[] };

type CategoriesResponse = { data?: Category[] };

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

async function fetchCategories(signal: AbortSignal): Promise<Category[]> {
  if (!API_URL) {
    throw new Error('EXPO_PUBLIC_API_URL belum diatur.');
  }
  const res = await fetch(`${API_URL}/v1/categories`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Gagal memuat kategori (HTTP ${res.status}).`);
  }
  const body = (await res.json()) as CategoriesResponse;
  return body.data ?? [];
}

// Groups the flat list by parent_id. A category whose parent is missing from
// the response is shown as top-level instead of disappearing.
function buildTree(categories: Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const c of categories) nodes.set(c.id, { ...c, children: [] });

  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export default function KategoriScreen() {
  const router = useRouter();
  const [tree, setTree] = useState<CategoryNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);

    try {
      const data = await fetchCategories(controller.signal);
      if (controller.signal.aborted) return;
      setTree(buildTree(data));
      setError(null);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan.');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load('initial');
    return () => controllerRef.current?.abort();
  }, [load]);

  const openCategory = useCallback(
    (slug: string) => {
      router.navigate({ pathname: '/', params: { kategori: slug } });
    },
    [router],
  );

  if (loading && !tree) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error && !tree) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => load('initial')}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>Coba lagi</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={tree ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} />
      }
      ListHeaderComponent={
        error ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.muted}>Belum ada kategori.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {item.name}
          </Text>
          {item.children.length === 0 ? (
            <Text style={[styles.muted, styles.emptyChildren]}>Belum ada sub-kategori.</Text>
          ) : (
            item.children.map((child) => (
              <CategoryRow key={child.id} node={child} depth={0} onPress={openCategory} />
            ))
          )}
        </View>
      )}
    />
  );
}

function CategoryRow({
  node,
  depth,
  onPress,
}: {
  node: CategoryNode;
  depth: number;
  onPress: (slug: string) => void;
}) {
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Lihat produk kategori ${node.name}`}
        onPress={() => onPress(node.slug)}
        style={({ pressed }) => [
          styles.row,
          { paddingLeft: 16 + depth * 16 },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.rowText}>{node.name}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      {node.children.map((child) => (
        <CategoryRow key={child.id} node={child} depth={depth + 1} onPress={onPress} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  list: {
    flexGrow: 1,
    padding: 16,
    gap: 16,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4d4d8',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    color: '#18181b',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingRight: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e4e4e7',
  },
  rowText: {
    fontSize: 15,
    color: '#27272a',
  },
  chevron: {
    fontSize: 20,
    color: '#a1a1aa',
  },
  pressed: {
    opacity: 0.6,
  },
  muted: {
    color: '#71717a',
  },
  emptyChildren: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  errorText: {
    color: '#b91c1c',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#18181b',
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
  banner: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
  },
  bannerText: {
    color: '#b91c1c',
  },
});
```
````

## What the checks said about the raw output

Before reading it line by line, the raw file was dropped into `app/(tabs)/kategori.tsx` unchanged and the app's own checks were run on it:

| Check                                  | Result                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (`tsc`, strict)       | **1 error**: `ListHeaderComponent={error ? … : null}`. React Native 0.88's types accept an element or `undefined`, not `null`                                                                                                                                                                                                                 |
| `eslint` (the app's type-aware config) | **5 errors**: two `type` aliases where the stylistic preset wants `interface`; `load('initial')` inside `useEffect` is a floating promise **and** a synchronous `setState` in an effect (`react-hooks/set-state-in-effect`, the React Compiler's rule); `onPress={() => onPress(node.slug)}` returns a void expression from a shorthand arrow |
| `prettier --check`                     | Fails: single quotes and line widths differ from the repository's Prettier defaults                                                                                                                                                                                                                                                           |

So the output would not have passed `make lint`, even before the question of whether it fits the project.

## Manual changes and why

Each row is one change, with the kind of problem it fixes. "Where now" is relative to `apps/mobile`.

| #   | Raw output                                                                                                                                                                | Change                                                                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Kind                       | Where now                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| 1   | Its own `fetch` to `` `${EXPO_PUBLIC_API_URL}/v1/categories` ``, throwing `'EXPO_PUBLIC_API_URL belum diatur.'` when the variable is unset                                | `listCategories(api, { signal })` from `@goshop/shared`, through the app's one client in `src/lib/api.ts`                                                                                                                                                                                                        | The app already has a client, and the raw `fetch` loses everything it does: `credentials: "omit"` (Expo's `fetch` defaults to sending and storing cookies, artikel 12), the 10 s timeout and one retry, `ApiError` with the contract's error `code` and the request ID. And an unset variable is the normal development case: `src/config/env.ts` falls back to `10.0.2.2:8080` (Android emulator) or `localhost:8080` (iOS simulator); the raw screen would show an error on a fresh clone | Wrong API use, conventions | `src/features/categories/api/categories.ts`                             |
| 2   | Hand-written `Category`, `CategoryNode` and `CategoriesResponse = { data?: Category[] }`, with `body.data ?? []`                                                          | The generated `Category` and the shared `CategoryNode` from `@goshop/shared`                                                                                                                                                                                                                                     | Types written from one sample drift from the contract; the generated ones change when `api/openapi.yaml` does. `data` is required in the contract: making it optional and defaulting to `[]` would show a broken response as "Belum ada kategori." instead of an error                                                                                                                                                                                                                      | Types                      | imported from `@goshop/shared`                                          |
| 3   | Its own `buildTree`                                                                                                                                                       | `buildCategoryTree` from `@goshop/shared`                                                                                                                                                                                                                                                                        | The same function, already written, tested (`packages/shared/src/catalog/category-tree.test.ts`) and used by the website's category menu. The raw version is correct for the API's data (it even puts an orphan at the top level), but a second copy is a second place to fix                                                                                                                                                                                                               | Conventions (duplication)  | `src/features/categories/hooks/useCategoryRows.ts`                      |
| 4   | `useState` × 4, `useRef<AbortController>`, `useCallback(load)`, `useEffect(() => { load('initial') })`                                                                    | TanStack Query: `categoriesQuery()` (`queryOptions`, key `["categories"]`, `staleTime` 5 minutes) and `useCategoryRows()` (`useQuery` with `select`)                                                                                                                                                             | The project fetches server data with TanStack Query (`.claude/agents/react-native-engineer.md`, the web's `useCategoryTree`). It gives cancellation, retry, dedup and a cache that survives switching tabs, which the hand-written loader re-fetched on every mount. It also removes both lint errors on the effect. The key and stale time are the web's (`apps/web/src/features/catalog/api/queries.ts`)                                                                                  | Conventions, lint          | `src/features/categories/api/categories.ts`, `hooks/useCategoryRows.ts` |
| 5   | Everything in the route file                                                                                                                                              | Route file thin; `api/`, `hooks/`, `components/` under `src/features/categories/`                                                                                                                                                                                                                                | The app's layout: `src/features/<feature>/{components,hooks,api}`, route files stay thin                                                                                                                                                                                                                                                                                                                                                                                                    | Conventions (structure)    | `app/(tabs)/kategori.tsx`                                               |
| 6   | `StyleSheet` with hard-coded colours (`#fff`, `#18181b`, `#d4d4d8`, `#b91c1c` …, Tailwind's zinc and red), `ActivityIndicator` and `RefreshControl` in their default grey | NativeWind `className` with GoShop's colour roles and their `dark:` twins (`bg-card dark:bg-card-dark`, `text-muted-foreground`, `border-destructive` …); the spinners take `colors.primary` from the navigation theme                                                                                           | The app styles with NativeWind and the storefront's roles (`src/theme/colors.js`, artikel 05). The raw colours are not GoShop's and ignore dark mode: on a dark phone the screen behind is dark (the navigation theme) while every card stays white. One inline style remains, the indentation, because it is a number computed from the data (the reason `ProductGrid` keeps its cell width inline)                                                                                        | Styling idiom, dark mode   | `src/features/categories/components/`                                   |
| 7   | A `›` character as the chevron                                                                                                                                            | No chevron; the `Icon` component's `kategori` glyph on top-level rows and in the empty state                                                                                                                                                                                                                     | Icons go through `src/components/Icon.tsx`, by meaning, so the icon set can change in one file. `Icon` has no chevron glyph yet, and adding one is a change to that file, which artikel 11 is reworking at the same time: it is requested from its owner rather than added here. A text glyph also renders differently per font and platform                                                                                                                                                | Styling idiom              | `components/CategoryList.tsx`                                           |
| 8   | Top-level categories are headings only; a parent without children shows "Belum ada sub-kategori." and cannot be opened                                                    | Every category is a row that opens the catalog; parents are bold with the icon                                                                                                                                                                                                                                   | Filtering by a parent includes its sub-categories' products (the API's rule; the website's `CategoryTree` links every node). In the raw screen a top-level category with no children was a dead end. The prompt said "tapping a sub-category": the model followed it literally, the prompt was the gap                                                                                                                                                                                      | Navigation, behaviour      | `components/CategoryList.tsx`                                           |
| 9   | A FlatList of top-level categories, each item rendering its whole sub-tree with a recursive `.map`                                                                        | The tree flattened into rows with a `depth` (`flattenCategoryTree`), one FlatList row per category, rows wrapped in `memo`                                                                                                                                                                                       | The unit a FlatList recycles is a row: a parent with fifty children was one tall item rendered at once. Flat rows also let every category be a pressable row of the same kind                                                                                                                                                                                                                                                                                                               | Performance, structure     | `hooks/useCategoryRows.ts`, `components/CategoryList.tsx`               |
| 10  | Rows labelled "Lihat produk kategori Kaos"; the loading state a bare spinner; the error a plain `Text`; parent titles `accessibilityRole="header"`                        | Label = the name, hint = what tapping does ("Membuka katalog kategori ini, termasuk subkategorinya" for a parent); loading has the words "Memuat kategori…" and `accessibilityState={{ busy: true }}`; errors are `accessibilityRole="alert"` with an Android live region; rows at least 48 dp tall (`min-h-12`) | The label/hint split is how `ProductCard` does it: TalkBack and VoiceOver read the name, then "button", then the hint, and a user can turn hints off. A spinner alone announces nothing; an error that appears must be announced. The header role went with change 8: a row is a button and cannot be a heading too, so the hierarchy is the bold name and the hint                                                                                                                         | Accessibility              | `components/CategoryList.tsx`, `components/CategoryStatus.tsx`          |
| 11  | Error text `Gagal memuat kategori (HTTP 500).` or the thrown message                                                                                                      | An Indonesian sentence picked by the error code (network, timeout, rate limit, anything else) and the request ID to quote                                                                                                                                                                                        | An HTTP status means nothing to a buyer; the website words its errors this way (`apps/web/src/lib/error-message.ts`). The request ID is what support needs to find the request in the API's logs                                                                                                                                                                                                                                                                                            | Missing states (error UX)  | `components/CategoryStatus.tsx`                                         |
| 12  | `RefreshControl refreshing={refreshing}`, set by its own loader                                                                                                           | `refreshing` true only for a pull the buyer started (`pulling`), not for every refetch                                                                                                                                                                                                                           | With TanStack Query a refetch can start on its own; tying the spinner to `isFetching` would pull the list down by itself. A local flag cleared when `refetch()` settles shows it only when the buyer asked                                                                                                                                                                                                                                                                                  | Behaviour                  | `app/(tabs)/kategori.tsx`                                               |
| 13  | `useRouter()` and `useCallback(openCategory, [router])`                                                                                                                   | The imperative `router` from `expo-router` at module level                                                                                                                                                                                                                                                       | As `app/(tabs)/index.tsx` does: the function needs nothing from the component, so it lives outside it and needs no memoisation                                                                                                                                                                                                                                                                                                                                                              | Conventions                | `app/(tabs)/kategori.tsx`                                               |
| 14  | `ListHeaderComponent={error ? … : null}`; `type` aliases; shorthand arrows returning `void`; single quotes                                                                | `undefined` instead of `null`; `interface`; braces around the handlers' bodies; `void` on the promises that are not awaited; Prettier's double quotes                                                                                                                                                            | The type error and the five lint errors above; the repository's Prettier settings                                                                                                                                                                                                                                                                                                                                                                                                           | Types, lint, formatting    | everywhere                                                              |
| 15  | `KategoriScreen`                                                                                                                                                          | `CategoriesScreen`, the name the placeholder had                                                                                                                                                                                                                                                                 | Code in English, words on screen in Indonesian, as in the rest of the app                                                                                                                                                                                                                                                                                                                                                                                                                   | Naming                     | `app/(tabs)/kategori.tsx`                                               |

Nothing in `packages/shared` changed: `listCategories`, `Category`, `buildCategoryTree` and `CategoryNode` already existed. The one dependency added is `@tanstack/react-query` from the workspace catalog (`"catalog:"`, 5.104.5, the web's and the dashboard's version).

### What the AI got right

- **The endpoint and the shape**, exactly as given: `GET /v1/categories`, `{ data: [...] }`, `parent_id: null` for the top level. No invented endpoint, no invented field, no invented library: it used only React Native and Expo Router.
- **The navigation.** `router.navigate({ pathname: '/', params: { kategori: slug } })` is the call the final screen makes: `navigate` rather than `push`, because `/` is a tab and pushing would not switch to it, and the object form passes the typed-routes check unchanged.
- **The edge cases of the tree**: a category whose parent is missing is shown at the top level instead of disappearing, the same rule `buildCategoryTree` follows.
- **Cancellation and races**: it aborted the request on unmount and ignored an answer that arrived after a newer request started. TanStack Query now does that, but the hand-written version was correct.
- **The states existed**: loading, error with "Coba lagi", empty ("Belum ada kategori."), pull-to-refresh, and keeping the old list with a note when a refresh fails. The final screen has the same states; only how they are built and worded changed.
- **Indonesian UI text and `accessibilityRole="button"`** on the pressable rows.

## From the raw output to the final code

The raw output is one 270-line file; the final code is five files. A line diff is a rewrite (`git diff --no-index` of the raw file against the final `app/(tabs)/kategori.tsx`: 59 insertions, 257 deletions), so the mapping is kept piece by piece instead:

| Raw output                                                   | Final                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `type Category`, `CategoryNode`, `CategoriesResponse`        | removed: `Category`, `CategoryNode` from `@goshop/shared` (change 2)                                       |
| `API_URL`, `fetchCategories`                                 | `src/features/categories/api/categories.ts`: `categoriesQuery()` over `listCategories(api)` (changes 1, 4) |
| `buildTree`                                                  | `src/features/categories/hooks/useCategoryRows.ts`: `buildCategoryTree` + `flattenCategoryTree` (3, 9)     |
| `useState`/`useRef`/`load`/`useEffect` in the screen         | `useCategoryRows()` (`useQuery` + `select`) and a `pulling` flag in the screen (4, 12)                     |
| `openCategory` (`useRouter`, `useCallback`)                  | module-level `openCategory` in `app/(tabs)/kategori.tsx`, same `navigate` call (13)                        |
| the loading branch (`ActivityIndicator`)                     | `CategoryLoading` in `src/features/categories/components/CategoryStatus.tsx` (10)                          |
| the error branch with "Coba lagi"                            | `CategoryError` in `CategoryStatus.tsx`, worded by error code with the request ID (10, 11)                 |
| the `FlatList` with `RefreshControl`, banner and empty state | `CategoryList` in `src/features/categories/components/CategoryList.tsx` (6, 7, 9)                          |
| `renderItem` (a section per parent) and `CategoryRow`        | `CategoryRowItem` in `CategoryList.tsx`: one row per category, indented by depth (8, 9, 10)                |
| `styles` (`StyleSheet.create`, 17 styles, hard-coded hex)    | NativeWind classes on each element; one inline `paddingLeft` for the depth (6)                             |

The raw file is reproduced in full above, so the before and after can both be read in the repository.

## Not verified here

- The screen has not run on a device yet: no emulator or simulator in this wave. `tsc`, ESLint, Prettier and `expo export` for Android and iOS pass.
- `useQuery` needs a `QueryClientProvider` at the root (`app/_layout.tsx`), which arrives with the catalog's product list (artikel 06). Until it is there the tab throws "No QueryClient set" when opened.
- Beranda must read `kategori` from its route (`useLocalSearchParams`) and send it to `GET /v1/products` as `category` (artikel 06). Until then a tap switches to Beranda but the list is not filtered.
- Whether `navigate` to `/` keeps or drops Beranda's current `q` and `urut` is to be checked on a device; the intent is a fresh category view.
