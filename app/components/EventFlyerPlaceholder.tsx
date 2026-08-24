import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { View, ViewStyle } from 'react-native';

/**
 * What an event shows instead of a flyer when it has no image.
 *
 * Most scraped events arrive with no `image_url` at all, so this is not a rare
 * edge case — on Explore it is a large share of the grid. It replaced a flat
 * grey rectangle (`colors.placeholder`), which is the bug-bash item "update
 * empty flyer image".
 *
 * Drawn rather than shipped as a PNG for two reasons: it has to sit in
 * containers from a ~64px thumbnail to a full-width detail hero without going
 * soft, and the tile grid is a repeating pattern that would be wasteful as a
 * raster.
 *
 * ANCHORING: preserveAspectRatio is "slice" (cover, not contain), so the
 * artwork always fills its box and crops instead of letterboxing. The anchor
 * defaults to bottom-left because that is where the tower sits — centring it
 * would clip the subject on wide containers like the event hero.
 *
 * The palette is fixed in both themes on purpose: it is artwork, not chrome,
 * and the cream tower reads correctly on the orange in light and dark. If
 * design later wants the fill tinted per `events.theme` to break up a wall of
 * identical cards on Explore, `background` is the only prop that has to change.
 */

/** Card fill. */
const FLYER_BG = '#F4B486';
/** The slightly darker tile; the 2px gap between tiles is FLYER_BG showing through. */
const FLYER_TILE = '#F2A56F';
/** Tower line art. */
const FLYER_INK = '#F1E7DE';

// The source artboard. Every coordinate below is in this space.
const VB_W = 198;
const VB_H = 162;

// Tiles are 37x37 on a 39px pitch, offset so the grid bleeds off every edge
// rather than starting flush against one.
const TILE = 37;
const PITCH = 39;
const TILE_X0 = -19;
const TILE_Y0 = -15;

const TILE_XS = Array.from(
  { length: Math.ceil((VB_W - TILE_X0) / PITCH) },
  (_, i) => TILE_X0 + i * PITCH,
);
const TILE_YS = Array.from(
  { length: Math.ceil((VB_H - TILE_Y0) / PITCH) },
  (_, i) => TILE_Y0 + i * PITCH,
);

/** The tower, straight from the design export. */
const TOWER_PATH =
  'M19.5194 95.0433C19.5664 95.0403 19.6136 95.0377 19.6607 95.0355C20.7037 94.9824 21.8861 95.0332 22.9483 95.0133C23.7218 95.0546 24.5887 94.9314 25.3472 95.0618C26.7868 95.3094 26.6745 96.7084 26.6741 97.7255C27.0518 97.723 27.4 97.7483 27.7756 97.7731C28.0511 97.9395 28.1072 98.0176 28.2933 98.2799C28.3591 99.4713 28.3062 101.055 28.3113 102.289C28.9659 102.672 30.386 103.513 30.8041 104.074C30.8285 104.177 30.8457 104.282 30.8556 104.388C30.9012 104.876 30.8795 105.611 30.8791 106.124L30.8808 109.022L30.8787 118.797L30.8803 131.069L30.8805 134.952C30.8811 135.722 31.0541 136.704 30.6015 137.313C30.0945 137.996 29.0706 137.485 29.046 136.801C29.0064 135.701 29.0272 134.585 29.0271 133.488L29.0281 126.749L29.0362 104.987C28.2162 104.369 27.0993 103.882 26.4687 103.121C26.394 102.246 26.4506 100.46 26.4553 99.5069C24.4891 99.5289 24.8075 98.3787 24.7989 96.8711L20.0631 96.875C20.0553 98.3742 20.4126 99.5449 18.4347 99.5181C18.4334 100.19 18.436 100.861 18.4425 101.533C18.4473 101.836 18.4791 102.59 18.436 102.86C18.4048 103.056 18.3181 103.238 18.1863 103.385C17.9397 103.664 16.3014 104.699 15.8753 104.991L15.8802 132.113L15.8827 140.086C15.8831 141.496 15.8243 142.936 15.8993 144.343C15.9169 144.673 15.9719 144.983 16.1579 145.265C16.3857 145.609 16.739 145.759 17.1334 145.831C20.4981 146.444 28.6115 143.031 31.6177 141.489C33.784 140.377 35.8332 139.126 37.8395 137.748C37.8988 133.721 38.495 130.74 39.8621 126.934C40.6574 124.91 41.6054 122.92 43.2701 121.426C44.6955 120.147 47.0379 119.585 48.3758 121.305C49.4738 122.716 49.0058 125.117 48.4947 126.696C47.3763 130.155 45.1955 133.292 42.6905 135.895C41.7624 136.862 40.73 137.729 39.681 138.572C40.0833 144.407 45.1029 142.86 48.4114 140.353C49.509 139.522 50.4386 138.757 51.3913 137.754C52.4269 136.672 53.3661 135.502 54.1985 134.257C54.5887 133.673 54.9072 133.054 55.3137 132.481C55.5914 132.066 56.0933 131.887 56.5395 132.163C57.4353 132.716 56.8177 133.696 56.4155 134.317C54.3675 137.472 51.7996 140.393 48.6336 142.463C46.5268 143.841 43.8294 144.989 41.3018 144.142C39.307 143.474 38.4043 141.777 38.0113 139.832C37.6062 140.044 37.0169 140.471 36.5979 140.734C35.6082 141.359 34.599 141.953 33.5722 142.515C29.6051 144.67 21.5085 148.264 16.7254 147.664C15.8974 147.523 15.115 147.093 14.6468 146.383C13.7751 145.062 14.0372 142.989 14.0362 141.438L14.0345 135.46L14.0349 117.083L14.0363 107.845C14.0354 106.805 13.9817 105.277 14.0719 104.27C14.1215 103.718 16.0638 102.612 16.5985 102.266L16.5858 99.8626C16.5836 99.4235 16.5583 98.9822 16.6147 98.5465C16.7346 97.62 17.5121 97.7247 18.2156 97.7277C18.2035 96.5146 18.094 95.4517 19.5194 95.0433Z';

/** The pennant, filled in the tile colour so it reads as a cut-out. */
const PENNANT_PATH =
  'M45.8392 122.088C45.9424 122.082 46.0452 122.079 46.1484 122.079C47.1697 122.085 47.2734 123.261 47.184 124.026C46.7086 128.114 43.4959 132.874 40.4933 135.521L39.7471 136.199C39.7702 135.626 39.8114 134.96 39.8855 134.393C40.2938 131.279 42.2747 122.864 45.8392 122.088Z';

/** The mast beside the tower. */
const MAST_PATH =
  'M22.0486 101.011C22.9472 100.975 23.2021 101.335 23.2166 102.184C23.2428 103.728 23.236 105.273 23.236 106.818L23.2394 115.521L23.233 142.122L22.3045 142.375L21.3995 142.617L21.3798 111.912L21.3822 105.019C21.3789 103.981 21.3295 102.691 21.4299 101.665C21.4573 101.385 21.82 101.145 22.0486 101.011Z';

type Props = {
  /** Where the artwork anchors when it has to crop. Bottom-left keeps the tower. */
  anchor?: 'xMinYMax' | 'xMidYMid';
  /** Overrides the card fill. The hook for a future per-theme tint. */
  background?: string;
  style?: ViewStyle;
};

export default function EventFlyerPlaceholder({
  anchor = 'xMinYMax',
  background = FLYER_BG,
  style,
}: Props) {
  return (
    <View
      style={[{ width: '100%', height: '100%', backgroundColor: background }, style]}
      // One image to a screen reader, not a pile of rectangles.
      accessible
      accessibilityRole="image"
      accessibilityLabel="No flyer provided for this event"
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio={`${anchor} slice`}
      >
        {TILE_YS.map((y) =>
          TILE_XS.map((x) => (
            <Rect key={`t-${x}-${y}`} x={x} y={y} width={TILE} height={TILE} fill={FLYER_TILE} />
          )),
        )}
        <Path d={TOWER_PATH} fill={FLYER_INK} />
        <Path d={PENNANT_PATH} fill={FLYER_TILE} />
        <Path d={MAST_PATH} fill={FLYER_INK} />
      </Svg>
    </View>
  );
}
