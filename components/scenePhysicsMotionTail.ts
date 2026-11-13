export const PHYSICS_MOTION_TAIL = `
    // Dispatch to the split branch functions (ANGLE Metal fix, 2026-11-13).
    // Every condition in branch A is 'motionType < x' with x <= 40.5 and
    // every condition in branch B is 'motionType < x' with x <= 80.5, so a
    // motionType at or above a boundary cannot match any branch in the
    // earlier group: routing by these boundaries selects exactly the branch
    // the original single chain would have matched first. Branch C keeps
    // the Chua range branch and the final else fallback.
    if (motionType < 40.5) {
      result = applyMotionBranchA(result, p, motionType, time, amp, freq, phase, rnd, wind, fluidForce, viscosity, noiseField, curlField, attractorScale, fieldPos, octaves, lacunarity);
    } else if (motionType < 80.5) {
      result = applyMotionBranchB(result, p, motionType, time, amp, freq, phase, rnd, wind, fluidForce, viscosity, noiseField, curlField, attractorScale, fieldPos, octaves, lacunarity);
    } else {
      result = applyMotionBranchC(result, p, motionType, time, amp, freq, phase, rnd, wind, fluidForce, viscosity, noiseField, curlField, attractorScale, fieldPos, octaves, lacunarity);
    }
    return result;
  }
`;
