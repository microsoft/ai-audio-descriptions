import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from engine import ad
from engine import ffmpeg
from engine import speech as speech_module
from engine import vtt


class GapTests(unittest.TestCase):
    def test_invert_clamps_merges_and_finds_free_time(self):
        spans = [(8, 12), (-2, 1), (3, 5), (4, 7)]
        self.assertEqual(ad._invert(spans, 10), [(1, 3), (7, 8)])

    def test_find_gaps_pads_speech_boundaries(self):
        segments = [ad.Segment(2, 3, "one"), ad.Segment(5, 6, "two")]
        gaps = ad.find_gaps(segments, duration=8, min_gap=1, has_audio=True)
        self.assertEqual(
            gaps,
            [
                ad.Gap(0.15, 1.85),
                ad.Gap(3.15, 4.85),
                ad.Gap(6.15, 7.85),
            ],
        )

    def test_find_gaps_uses_word_timing_inside_a_long_phrase(self):
        segments = [
            ad.Segment(
                1.95,
                24.75,
                "Several phrases with long pauses.",
                (
                    (1.95, 2.83),
                    (10.59, 11.63),
                    (18.03, 19.03),
                    (24.07, 24.75),
                ),
            )
        ]

        gaps = ad.find_gaps(
            segments, duration=25, min_gap=1.2, has_audio=True
        )
        self.assertEqual(
            [(round(gap.start, 2), round(gap.end, 2)) for gap in gaps],
            [(0.15, 1.8), (2.98, 10.44), (11.78, 17.88), (19.18, 23.92)],
        )

    def test_split_gaps_avoids_short_pieces(self):
        gap = ad.Gap(0, 10)
        self.assertEqual(
            ad.split_gaps_on_shots([gap], [1, 4, 7], piece_floor=2.5),
            [ad.Gap(0, 4), ad.Gap(4, 7), ad.Gap(7, 10)],
        )


class FrameSelectionTests(unittest.TestCase):
    def test_catchup_selection_covers_the_cut_range(self):
        gap = ad.Gap(20, 23)
        cuts = list(range(1, 20))
        times = ad.catchup_times(gap, cuts, since=0)
        self.assertEqual(len(times), 3)
        self.assertLess(times[0], times[-1])
        self.assertGreater(times[-1], 15)

    def test_frame_times_include_context_and_gap_midpoints(self):
        self.assertEqual(ad.frame_times(ad.Gap(10, 15)), [9.5, 11.25, 13.75])


class PromptTests(unittest.TestCase):
    def test_system_prompt_leaves_ad_writing_to_the_model(self):
        self.assertEqual(
            ad.SYSTEM_PROMPT,
            "Write the next line of an audio description track for this video.\n"
            "Describe the most important new visual information not already clear "
            "from the dialogue or previous descriptions, using established names "
            "where helpful.\n"
            "Ground the description in the frames and context; do not invent "
            "unseen events, motives, or intent.\n"
            "Return only concise narration that fits the gap, or SKIP if no "
            "description is needed.",
        )

    def test_description_prompt_contains_only_generation_context(self):
        prompt = ad.build_description_prompt(
            ad.Gap(10, 14),
            [
                ad.Segment(8, 9, "Before."),
                ad.Segment(15, 16, "After."),
            ],
            ["First description.", "Second description."],
            since=5,
            catchup_count=2,
            same_shot_text="Second description.",
        )

        self.assertEqual(
            prompt,
            "Available gap: 4.0s starting at 00:00:10.000; maximum 12 words.\n\n"
            "Dialogue:\n"
            "Since the previous description: Before.\n"
            "After the gap: After.\n\n"
            "Previous audio descriptions:\n"
            "- First description.\n"
            "- Second description.\n\n"
            "Frames: First 2 frame(s): earlier context since the previous "
            "description. Remaining frames: this gap.\n"
            'Continuity: no cut since the previous description, "Second '
            'description.".',
        )

    def test_dialogue_phrase_remains_context_for_an_internal_pause(self):
        segment = ad.Segment(
            1.95,
            11.63,
            "He's gonna do it! You gotta see this!",
            ((1.95, 2.83), (10.59, 11.63)),
        )

        self.assertEqual(
            ad._transcript_context([segment], ad.Gap(2.98, 10.44)),
            "Around the gap: He's gonna do it! You gotta see this!",
        )

    def test_content_filter_context_keeps_only_nearest_dialogue(self):
        segments = [
            ad.Segment(1, 2, "Old."),
            ad.Segment(3, 4, "Before."),
            ad.Segment(5, 8, "Around."),
            ad.Segment(9, 10, "After."),
            ad.Segment(11, 12, "Later."),
        ]

        self.assertEqual(
            ad._content_filter_context(segments, ad.Gap(6, 7)),
            [segments[1], segments[2], segments[3]],
        )


class VTTTests(unittest.TestCase):
    def test_timestamp_rounds_to_milliseconds(self):
        self.assertEqual(vtt.format_timestamp(3661.2346), "01:01:01.235")
        self.assertEqual(vtt.format_timestamp(-1), "00:00:00.000")

    def test_generated_cue_uses_full_available_window_end(self):
        cues = ad.build_cues(
            [ad.Description(ad.Gap(1.25, 4.75), "She opens the door.")],
            duration=10,
        )
        self.assertEqual(cues[0].end, 4.75)

    def test_parse_and_write_multiline_manual_vtt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manual = root / "manual.vtt"
            manual.write_text(
                "\ufeffWEBVTT Manual descriptions\n\n"
                "NOTE editor comment\ncontinued comment\n\n"
                "opening\n"
                "00:00.500 --> 00:03.250 align:start\n"
                "She opens the door.\n"
                "A dog runs inside.\n\n",
                encoding="utf-8",
            )
            cues = vtt.read(manual)
            self.assertEqual(
                cues,
                (
                    vtt.Cue(
                        0.5,
                        3.25,
                        "She opens the door.\nA dog runs inside.",
                    ),
                ),
            )

            written = root / "written.vtt"
            vtt.write(cues, written)
            self.assertEqual(vtt.read(written), cues)

    def test_rejects_malformed_timestamps(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "bad.vtt"
            path.write_text(
                "WEBVTT\n\n00:00:01,000 --> 00:00:02.000\nText\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(vtt.VTTError, "Malformed timestamp"):
                vtt.read(path)

    def test_rejects_overlapping_cues(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "overlap.vtt"
            path.write_text(
                "WEBVTT\n\n"
                "00:00.000 --> 00:02.000\nFirst\n\n"
                "00:01.000 --> 00:03.000\nSecond\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(vtt.VTTError, "overlaps cue 1"):
                vtt.read(path)

    def test_cue_identifier_starting_with_note_is_not_a_comment(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "identifier.vtt"
            path.write_text(
                "WEBVTT\n\n"
                "NOTE-1\n"
                "00:00.000 --> 00:02.000\n"
                "First\n",
                encoding="utf-8",
            )
            self.assertEqual(len(vtt.read(path)), 1)


class SpeechFormattingTests(unittest.TestCase):
    def test_transcript_keeps_phrase_text_and_word_speech_spans(self):
        segments = speech_module._transcript_segments(
            {
                "phrases": [
                    {
                        "offsetMilliseconds": 1950,
                        "durationMilliseconds": 9680,
                        "text": "He's gonna do it! You gotta see this!",
                        "words": [
                            {
                                "offsetMilliseconds": 1950,
                                "durationMilliseconds": 880,
                            },
                            {
                                "offsetMilliseconds": 10590,
                                "durationMilliseconds": 1040,
                            },
                        ],
                    }
                ]
            }
        )

        self.assertEqual(len(segments), 1)
        self.assertAlmostEqual(segments[0].start, 1.95)
        self.assertAlmostEqual(segments[0].end, 11.63)
        self.assertEqual(
            segments[0].text,
            "He's gonna do it! You gotta see this!",
        )
        self.assertEqual(
            [
                (round(start, 2), round(end, 2))
                for start, end in segments[0].speech_spans
            ],
            [(1.95, 2.83), (10.59, 11.63)],
        )

    def test_transcript_falls_back_to_phrase_timing_without_words(self):
        segments = speech_module._transcript_segments(
            {
                "phrases": [
                    {
                        "offsetMilliseconds": 2000,
                        "durationMilliseconds": 1000,
                        "text": "Hello.",
                    }
                ]
            }
        )

        self.assertEqual(
            segments[0].speech_spans,
            ((2.0, 3.0),),
        )

    def test_ssml_escapes_text_and_voice(self):
        ssml = speech_module._ssml(
            'A & B < C > D "quoted" \'said\'', "voice&name", 10
        )
        self.assertIn(
            "A &amp; B &lt; C &gt; D &quot;quoted&quot; &apos;said&apos;",
            ssml,
        )
        self.assertIn('name="voice&amp;name"', ssml)
        self.assertIn('<prosody rate="+10%">', ssml)

    def test_speech_config_sets_aad_token_after_endpoint_construction(self):
        class FakeConfig:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
                self.authorization_token = None

        speechsdk = Mock(SpeechConfig=FakeConfig)
        config = speech_module._speech_config(
            speechsdk,
            "https://example.cognitiveservices.azure.com",
            "/subscriptions/example/resourceGroups/example/providers/"
            "Microsoft.CognitiveServices/accounts/example",
            "token",
        )

        self.assertEqual(
            config.kwargs,
            {"endpoint": "https://example.cognitiveservices.azure.com/"},
        )
        self.assertEqual(
            config.authorization_token,
            "aad#/subscriptions/example/resourceGroups/example/providers/"
            "Microsoft.CognitiveServices/accounts/example#token",
        )


class FFmpegTests(unittest.TestCase):
    def test_failed_frame_extraction_removes_stale_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "frame.jpg"
            output.write_bytes(b"stale")
            failed = Mock(returncode=1)
            with patch("engine.ffmpeg.run", return_value=failed):
                self.assertIsNone(
                    ffmpeg.extract_frame(Path("video.mp4"), 1.0, output, 768)
                )
            self.assertFalse(output.exists())

    def test_audio_mixing_uses_one_ffmpeg_command(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            info = ffmpeg.MediaInfo(
                root / "video.mp4", 60.0, True, 1920, 1080, 30.0
            )
            clips = [
                (float(index), 0.5, root / f"cue{index:03d}.wav")
                for index in range(3)
            ]
            with patch("engine.ffmpeg.run") as run:
                ffmpeg.mix_audio(info, clips, root / "mixed.wav", -10.0)

            run.assert_called_once()
            command = run.call_args.args[0]
            self.assertIn("-filter_complex", command)
            self.assertEqual(command.count("-i"), 4)


class FakeSpeech:
    def __init__(self, segments=()):
        self.segments = segments
        self.transcribe_calls = 0
        self.synthesis_rates = []

    def transcribe(self, _audio):
        self.transcribe_calls += 1
        return self.segments

    def synthesize(self, _text, output, _voice, rate_pct=0):
        self.synthesis_rates.append(rate_pct)
        Path(output).write_bytes(b"wav")
        return Path(output)


class EngineTestCase(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.video = self.root / "source.mp4"
        self.video.write_bytes(b"video")
        self.info = ffmpeg.MediaInfo(self.video, 10.0, True, 1920, 1080, 30.0)

    def tearDown(self):
        self.temporary.cleanup()

    def media_patches(self):
        return (
            patch("engine.ad.ffmpeg.require_tools"),
            patch("engine.ad.ffmpeg.probe_video", return_value=self.info),
        )


class GenerateADTests(EngineTestCase):
    def test_content_filter_reuses_single_gap_frame_with_reduced_context(self):
        frame = Path("only.jpg")

        self.assertEqual(
            ad._content_filter_fallback_frames([frame], 0),
            [frame],
        )
        self.assertEqual(
            ad._content_filter_fallback_frames([frame], 1),
            [],
        )

    def test_content_filter_retries_with_one_representative_gap_frame(self):
        class ContentFilterError(Exception):
            status_code = 400
            code = "content_filter"

        self.info = ffmpeg.MediaInfo(
            self.video, 4.0, False, 1920, 1080, 30.0
        )
        require, probe = self.media_patches()
        with (
            require,
            probe,
            patch("engine.ad.ffmpeg.detect_shots", return_value=[]),
            patch(
                "engine.ad.ffmpeg.extract_frame",
                side_effect=lambda _video, _time, target, _width: target,
            ),
            patch(
                "engine.ad.openai_transport.generate_description",
                side_effect=[ContentFilterError(), "A woman runs."],
            ) as model,
        ):
            result = ad.generate_ad(
                self.video,
                self.root / "out.vtt",
                speech=FakeSpeech(),
                openai_client=object(),
                model="deployment",
            )

        self.assertEqual(len(model.call_args_list[0].args[4]), 2)
        self.assertEqual(len(model.call_args_list[1].args[4]), 1)
        self.assertIn(
            "Frames: This gap",
            model.call_args_list[1].args[3],
        )
        self.assertEqual(result.cues[0].text, "A woman runs.")
        self.assertEqual(result.warnings[0].stage, "model_fallback")

    def test_generate_does_not_synthesize_and_keeps_supplied_workspace(self):
        speech = FakeSpeech(
            [
                speech_module.TranscriptSegment(2, 3, "First line."),
                speech_module.TranscriptSegment(6, 7, "Second line."),
            ]
        )
        workspace = self.root / "workspace"
        output = self.root / "descriptions.vtt"
        progress = []
        descriptions = [
            RuntimeError("model unavailable"),
            "She crosses the room.",
            "",
        ]

        require, probe = self.media_patches()
        with (
            require,
            probe,
            patch(
                "engine.ad.ffmpeg.extract_audio",
                side_effect=lambda _source, target: target,
            ),
            patch("engine.ad.ffmpeg.detect_shots", return_value=[]),
            patch(
                "engine.ad.ffmpeg.extract_frame",
                side_effect=lambda _video, _time, target, _width: target,
            ),
            patch(
                "engine.ad.openai_transport.generate_description",
                side_effect=descriptions,
            ),
        ):
            result = ad.generate_ad(
                self.video,
                output,
                speech=speech,
                openai_client=object(),
                model="deployment",
                workspace=workspace,
                progress=lambda stage, current, total: progress.append(
                    (stage, current, total)
                ),
            )

        self.assertEqual(speech.synthesis_rates, [])
        self.assertTrue(workspace.exists())
        self.assertTrue(output.exists())
        self.assertEqual(result.cues[0].end, 5.85)
        self.assertEqual(result.warnings[0].stage, "model")
        stages = []
        for stage, _, _ in progress:
            if not stages or stages[-1] != stage:
                stages.append(stage)
        self.assertEqual(
            stages,
            [
                "preparing",
                "transcribing",
                "detecting_shots",
                "describing",
                "writing_vtt",
            ],
        )

    def test_frame_failures_become_warnings(self):
        self.info = ffmpeg.MediaInfo(
            self.video, 4.0, False, 1920, 1080, 30.0
        )
        require, probe = self.media_patches()
        calls = 0

        def extract(_video, _time, target, _width):
            nonlocal calls
            calls += 1
            return None if calls == 1 else target

        with (
            require,
            probe,
            patch("engine.ad.ffmpeg.detect_shots", return_value=[]),
            patch("engine.ad.ffmpeg.extract_frame", side_effect=extract),
            patch(
                "engine.ad.openai_transport.generate_description",
                return_value="A person enters.",
            ),
        ):
            result = ad.generate_ad(
                self.video,
                self.root / "out.vtt",
                speech=FakeSpeech(),
                openai_client=object(),
                model="deployment",
            )
        self.assertEqual(result.warnings[0].stage, "frames")


class RenderADTests(EngineTestCase):
    def write_vtt(self, end=2.0):
        path = self.root / "input.vtt"
        vtt.write(
            [vtt.Cue(0.0, end, "She opens the door.")], path
        )
        return path

    @staticmethod
    def mux_side_effect(_video, _audio, output):
        Path(output).write_bytes(b"mp4")
        return Path(output)

    def test_render_does_not_transcribe_or_call_openai(self):
        speech = FakeSpeech()
        speech.transcribe = Mock(side_effect=AssertionError("transcribe called"))
        output = self.root / "output.mp4"
        require, probe = self.media_patches()
        with (
            require,
            probe,
            patch(
                "engine.ad.ffmpeg.trim_outer_silence", return_value=1.0
            ),
            patch("engine.ad.ffmpeg.mix_audio"),
            patch(
                "engine.ad.ffmpeg.mux_video",
                side_effect=self.mux_side_effect,
            ),
            patch(
                "engine.ad.openai_transport.generate_description",
                side_effect=AssertionError("OpenAI called"),
            ) as model,
        ):
            result = ad.render_ad(
                self.video,
                self.write_vtt(),
                output,
                speech=speech,
            )
        self.assertEqual(speech.synthesis_rates, [0])
        speech.transcribe.assert_not_called()
        model.assert_not_called()
        self.assertEqual(result.output_video, output.resolve())
        self.assertTrue(output.exists())

    def test_fitting_order_is_normal_then_prosody_then_atempo(self):
        events = []
        speech = FakeSpeech()

        def synthesize(_text, output, _voice, rate_pct=0):
            events.append(f"synthesize:{rate_pct}")
            Path(output).write_bytes(b"wav")
            return Path(output)

        speech.synthesize = synthesize
        trim_durations = iter([3.0, 2.5])

        def trim(_source, _output):
            events.append("trim")
            return next(trim_durations)

        def atempo(_source, _output, tempo):
            events.append(f"atempo:{tempo:.2f}")
            return 1.9

        require, probe = self.media_patches()
        with (
            require,
            probe,
            patch(
                "engine.ad.ffmpeg.trim_outer_silence", side_effect=trim
            ),
            patch("engine.ad.ffmpeg.atempo", side_effect=atempo),
            patch("engine.ad.ffmpeg.mix_audio"),
            patch(
                "engine.ad.ffmpeg.mux_video",
                side_effect=self.mux_side_effect,
            ),
        ):
            result = ad.render_ad(
                self.video,
                self.write_vtt(),
                self.root / "output.mp4",
                speech=speech,
            )

        self.assertEqual(
            events,
            ["synthesize:0", "trim", "synthesize:20", "trim", "atempo:1.15"],
        )
        self.assertEqual(result.cues[0].prosody_rate, 20)
        self.assertEqual(result.cues[0].tempo, 1.15)
        self.assertAlmostEqual(result.cues[0].duration, 1.9)

    def test_irreducible_overflow_does_not_mix_or_mux(self):
        output = self.root / "output.mp4"
        mix = Mock()
        mux = Mock()
        require, probe = self.media_patches()
        with (
            require,
            probe,
            patch(
                "engine.ad.ffmpeg.trim_outer_silence",
                side_effect=[4.0, 3.5],
            ),
            patch("engine.ad.ffmpeg.atempo", return_value=3.0),
            patch("engine.ad.ffmpeg.mix_audio", mix),
            patch("engine.ad.ffmpeg.mux_video", mux),
        ):
            with self.assertRaisesRegex(ad.ADError, "cue 1"):
                ad.render_ad(
                    self.video,
                    self.write_vtt(),
                    output,
                    speech=FakeSpeech(),
                )
        mix.assert_not_called()
        mux.assert_not_called()
        self.assertFalse(output.exists())

    def test_workspace_filename_cannot_delete_the_source(self):
        source = self.root / "rendered.mp4"
        source.write_bytes(b"source")
        self.video = source
        self.info = ffmpeg.MediaInfo(source, 10.0, True, 1920, 1080, 30.0)
        require, probe = self.media_patches()
        output = self.root / "published" / "output.mp4"
        with (
            require,
            probe,
            patch("engine.ad.ffmpeg.trim_outer_silence", return_value=1.0),
            patch("engine.ad.ffmpeg.mix_audio"),
            patch(
                "engine.ad.ffmpeg.mux_video",
                side_effect=self.mux_side_effect,
            ),
        ):
            ad.render_ad(
                source,
                self.write_vtt(),
                output,
                speech=FakeSpeech(),
                workspace=self.root,
            )
        self.assertEqual(source.read_bytes(), b"source")
        self.assertTrue(output.exists())


if __name__ == "__main__":
    unittest.main()
