import type { GameIndex } from './loader.ts';
import type { Recipe } from './schema.ts';

/**
 * Whether a recipe is a way you would plan to make something, as opposed to
 * a side door into it. Recycling and barrelling technically produce iron
 * plate and petroleum gas, and the data lists forty-odd recycling recipes for
 * iron plate alone; offering those first is how "drag from the input, press
 * Enter" ended up suggesting firearm magazine recycling.
 */
export function isStandardRecipe(recipe: Recipe): boolean {
  if (recipe.producers.length === 0) return false;
  if (recipe.id.endsWith('-recycling')) return false;
  if (recipe.producers.every((id) => id === 'recycler')) return false;
  // Emptying a barrel, and filling one.
  if (recipe.id.startsWith('empty-') && recipe.id.endsWith('-barrel')) return false;
  if (recipe.inputs.some((input) => input.itemId === 'barrel')) return false;
  return true;
}

/**
 * The one recipe Expand can pick for `itemId` without asking, or null when
 * there is a real choice to make — petroleum gas, solid fuel, uranium.
 *
 * A recipe named after its item wins (`iron-plate` for iron plate, not casting
 * it); then a sole standard recipe; then mining, for ores.
 */
export function mainRecipe(index: GameIndex, itemId: string): string | null {
  const named = index.recipes.get(itemId);
  if (named && named.producers.length > 0 && named.outputs.some((out) => out.itemId === itemId)) {
    return named.id;
  }
  const standard = (index.producersOf.get(itemId) ?? [])
    .map((id) => index.recipes.get(id))
    .filter((recipe): recipe is Recipe => recipe !== undefined && isStandardRecipe(recipe));
  if (standard.length === 1) return standard[0]!.id;
  const mined = standard.find((recipe) => recipe.id === `${itemId}-mining`);
  return mined?.id ?? null;
}

/**
 * Search order for recipes that continue a dragged connection: the main recipe
 * first, other standard ones next, recycling and barrels last. Stable within
 * each group, so the data set's own order still decides ties.
 */
export function recipeOrder(index: GameIndex, itemId: string): (recipe: Recipe) => number {
  const main = mainRecipe(index, itemId);
  return (recipe) => (recipe.id === main ? 0 : isStandardRecipe(recipe) ? 1 : 2);
}
