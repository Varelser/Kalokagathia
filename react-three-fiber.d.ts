import type { ThreeElements } from '@react-three/fiber';

declare module 'react' {
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional: registers R3F elements in the JSX namespace via declaration merging
    interface IntrinsicElements extends ThreeElements {}
  }
}
