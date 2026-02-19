import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { BodyGraphScene } from "@hdhub/bodygraph-3d";

interface BodyGraphWrapperProps {
  data: any;
}

export default function BodyGraphWrapper({ data }: BodyGraphWrapperProps) {
  return (
    <Canvas
      style={{ width: "100%", height: "100%" }}
      dpr={[1, 1.5]}
      camera={{ position: [3, 3, 3], fov: 45 }}
    >
      <Suspense fallback={null}>
        <BodyGraphScene data={data} />
      </Suspense>
    </Canvas>
  );
}
