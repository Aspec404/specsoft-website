import sys
import time
import cv2  # Simulating camera input
# Mocking a face tracking and Live2D/VRM rendering framework
import mock_face_mesh as tracking_sdk
import mock_live2d_engine as vtuber_renderer


class VTuberPipeline:

    def __init__(self, model_path):
        print(f"[System] Initializing camera stream...")
        self.cap = cv2.VideoCapture(0)

        print(f"[System] Loading Anime Model from: {model_path}...")
        self.model = vtuber_renderer.LoadModel(model_path)

        print(f"[System] Initializing AI Face Mesh Tracker...")
        self.tracker = tracking_sdk.FaceMeshTracker(min_confidence=0.8)

    def run(self):
        print("\n=== VTuber Stream Active ===")
        print("Press 'q' in the window to stop testing.\n")

        while self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                print("[Error] Failed to grab webcam frame.")
                break

            # 1. Detect facial landmarks from the webcam frame
            face_landmarks = self.tracker.process_frame(frame)

            if face_landmarks:
                # 2. Extract and calculate tracking values (normalized 0.0 to 1.0)
                mouth_open = face_landmarks.get_mouth_aspect_ratio()
                left_eye_blink = face_landmarks.get_eye_closure_left()
                right_eye_blink = face_landmarks.get_eye_closure_right()
                head_rotation = face_landmarks.get_head_pose_angles()  # (pitch, yaw, roll)

                # 3. Map tracking data to the Anime Model's rigging parameters
                self.model.set_parameter("ParamMouthOpenY", mouth_open()
                self.model.set_parameter("ParamEyeOpenL", 1.0 - left_eye_blink)
                self.model.set_parameter("ParamEyeOpenR", 1.0 - right_eye_blink)
                self.model.set_parameter("ParamAngleX", head_rotation["yaw"])
                self.model.set_parameter("ParamAngleY", head_rotation["pitch"])
                self.model.set_parameter("ParamAngleZ", head_rotation["roll"])

                # 4. Trigger the mock engine to redraw the model with new parameters
                rendered_avatar = self.model.update_and_render()

                # Display the simulated VTuber window
                cv2.imshow("VTuber Mock Render Window", rendered_avatar)
            else:
                # If no face is detected, smoothly return the model to its idle pose
                self.model.blend_to_idle_pose(speed=0.1)
                cv2.imshow("VTuber Mock Render Window", self.model.get_current_frame())

            # Break loop on 'q' key press
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

        self.cleanup()

    def cleanup(self):
        print("[System] Shutting down VTuber pipeline...")
        self.cap.release()
        cv2.destroyAllWindows()
        print("[System] Pipeline safely closed.")


if __name__ == "__main__":
    # Simulate targeting a standard Live2D model file configuration
    MOCK_MODEL_FILE = "assets/models/anime_girl_v2/model3.json"

    pipeline = VTuberPipeline(MOCK_MODEL_FILE)
    pipeline.run()
