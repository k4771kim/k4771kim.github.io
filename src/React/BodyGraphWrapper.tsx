import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { BodyGraphScene } from "@hdhub/bodygraph-3d";

interface BodyGraphWrapperProps {
  data: any;
}

export default function BodyGraphWrapper({ data }: BodyGraphWrapperProps) {
  return (
    <Canvas camera={{ position: [3, 3, 3], fov: 45 }}>
      <Suspense fallback={null}>
        <BodyGraphScene data={data} />
      </Suspense>
    </Canvas>
  );
}
